// License gate -- must run before any service initialization
const { validateEnv } = require('./utils/validateEnv');
const { validate: validateLicense, isValid } = require('./services/LicenseValidator');

const SageService = require('./services/sageService');
const FracttalClient = require('./services/fracttalClient');
const ConfigManager = require('./config/configManager');
const cron = require('node-cron');
const logger = require('./config/logger');
require('dotenv').config();

// Validate environment variables first (exits on missing vars)
validateEnv();

const sage = new SageService();
const fracttal = new FracttalClient();
const configManager = new ConfigManager();

async function syncInventory(options = {}) {
    const { dryRun = false } = options;
    const tag = dryRun ? '[DRY-RUN] ' : '';

    try {
        // LIC-02: Re-validate license on each sync cycle (periodic, no startup flag)
        await validateLicense();
        if (!isValid()) {
            logger.error('License invalid — aborting sync');
            return;
        }

        if (dryRun) {
            logger.info('[DRY-RUN] Iniciando dry-run de sincronización — NO se enviará ninguna escritura a Fracttal');
        } else {
            logger.info('Iniciando proceso de sincronización de inventario...');
        }

        // Validar configuración
        configManager.validateConfig();
        logger.info(`${tag}Configuración validada exitosamente`);

        // Validar conexiones
        const sageConnected = await sage.validateConnection();
        const fracttalAuthenticated = await fracttal.getAccessToken();

        if (!sageConnected || !fracttalAuthenticated) {
            logger.error(`${tag}No se pudo establecer conexión con Sage300 o autenticación con Fracttal`);
            return;
        }

        // Obtener todos los items de inventario desde Sage300 (aplica inventoryFilters de config.json)
        const sageItems = await sage.getAllInventoryItems();
        logger.info(`${tag}Se obtuvieron ${sageItems.length} items desde Sage300 tras aplicar filtros de familia`);

        let processedItems = 0;
        let updatedItems = 0;        // Case A — existían en almacén → ajuste de stock
        let createdItems = 0;         // Case B + Case C — asociados o creados
        let errors = 0;
        let warehousesCreated = [];
        let warehousesMissing = [];   // Almacenes que NO existen (en dry-run no se crean)
        const preview = [];           // Detalle item por item (sobre todo útil en dry-run)

        for (const sageItem of sageItems) {
            try {
                const itemCode = sageItem.ItemNumber?.trim();
                const sageLocation = sageItem.Location?.trim();

                if (!itemCode || !sageLocation) {
                    logger.warn(`${tag}Item sin código o ubicación válida: ${JSON.stringify(sageItem)}`);
                    continue;
                }

                // Mapear ubicación de Sage a almacén de Fracttal
                const fracttalWarehouse = sage.mapSageLocationToFracttalWarehouse(
                    sageLocation,
                    itemCode,
                    sageItem.Description?.trim() || ''
                );

                // Si no se puede mapear la ubicación, saltar este item
                if (!fracttalWarehouse) {
                    logger.warn(`${tag}Ubicación ${sageLocation} no soportada para item ${itemCode} - saltando`);
                    continue;
                }

                // Asegurar que el almacén existe.
                // En dry-run: solo consultar; nunca crear. En modo real: crear si no existe (comportamiento original).
                if (dryRun) {
                    try {
                        await fracttal.getWarehouseByCode(fracttalWarehouse);
                        if (!warehousesCreated.includes(fracttalWarehouse)) {
                            warehousesCreated.push(fracttalWarehouse);
                        }
                    } catch (warehouseError) {
                        if (warehouseError.response && warehouseError.response.status === 404) {
                            if (!warehousesMissing.includes(fracttalWarehouse)) {
                                warehousesMissing.push(fracttalWarehouse);
                                logger.warn(`[DRY-RUN] Almacén ${fracttalWarehouse} no existe en Fracttal — se crearía en modo real`);
                            }
                            // Continuamos para clasificar el item como Case C (item nuevo en almacén nuevo).
                        } else {
                            logger.error(`[DRY-RUN] Error consultando almacén ${fracttalWarehouse}:`, warehouseError.message);
                            continue;
                        }
                    }
                } else {
                    try {
                        await fracttal.ensureWarehouseExists(fracttalWarehouse);
                        if (!warehousesCreated.includes(fracttalWarehouse)) {
                            warehousesCreated.push(fracttalWarehouse);
                        }
                    } catch (warehouseError) {
                        logger.error(`Error asegurando que el almacén ${fracttalWarehouse} existe:`, warehouseError.message);
                        continue;
                    }
                }

                // Verificar si el item existe en Fracttal y está asociado al almacén.
                // Si el almacén no existe (dry-run), igual podemos consultar el item — exists/inWarehouse vendrá false.
                let itemStatus;
                try {
                    itemStatus = await fracttal.checkItemExistsInWarehouse(itemCode, fracttalWarehouse);
                } catch (statusError) {
                    errors++;
                    logger.error(`${tag}Error consultando estado del item ${itemCode}:`, statusError.message);
                    continue;
                }

                // Datos de ajuste de inventario (stock, costo, min/max)
                const adjustmentData = {
                    code_warehouse: fracttalWarehouse,
                    stock: parseFloat(sageItem.QuantityOnHand) || 0,
                    unit_cost_stock: parseFloat(sageItem.LastCost) || 0,
                    min_stock_level: parseFloat(sageItem.MinimumStock) || 0,
                    max_stock_level: parseFloat(sageItem.MinimumStock) * 3 || 100
                };

                // Determinar caso (A / B / C) y stock actual de Fracttal si aplica
                let caseLabel;
                let currentStockInWarehouse = null;
                if (itemStatus.exists && itemStatus.inWarehouse) {
                    caseLabel = 'A';
                    currentStockInWarehouse = itemStatus.warehouseData?.stock ?? null;
                } else if (itemStatus.exists && !itemStatus.inWarehouse) {
                    caseLabel = 'B';
                } else {
                    caseLabel = 'C';
                }

                if (caseLabel === 'A') {
                    // CASE A: existe + en almacén → solo ajustar stock
                    if (dryRun) {
                        logger.info(`[DRY-RUN] Case A — ${itemCode} en ${fracttalWarehouse}: ajustaría stock ${currentStockInWarehouse} → ${adjustmentData.stock}`);
                    } else {
                        logger.info(`Actualizando inventario: ${itemCode} en almacén ${fracttalWarehouse}`);
                        await fracttal.adjustInventoryStock(itemCode, adjustmentData);
                    }
                    updatedItems++;

                } else if (caseLabel === 'B') {
                    // CASE B: existe pero no en este almacén → asociar + ajustar stock
                    if (dryRun) {
                        logger.info(`[DRY-RUN] Case B — ${itemCode}: se asociaría al almacén ${fracttalWarehouse} y luego ajustaría stock a ${adjustmentData.stock}`);
                    } else {
                        logger.info(`Asociando item ${itemCode} al almacén ${fracttalWarehouse}`);
                        await fracttal.associateItemToWarehouse(itemCode, fracttalWarehouse, {
                            stock: 0,
                            unit_cost_stock: 0,
                            min_stock_level: adjustmentData.min_stock_level,
                            max_stock_level: adjustmentData.max_stock_level
                        });
                        await fracttal.adjustInventoryStock(itemCode, adjustmentData);
                    }
                    createdItems++;

                } else {
                    // CASE C: item nuevo → crear con almacén + ajustar stock
                    const createData = {
                        code: itemCode,
                        field_1: sageItem.Description?.trim() || itemCode,
                        id_type_item: 4,
                        code_warehouse: fracttalWarehouse,
                        unit_code: 'UN',
                        unit_description: 'Unidad',
                        stock: 0,
                        min_stock_level: adjustmentData.min_stock_level,
                        max_stock_level: adjustmentData.max_stock_level,
                        barcode: itemCode,
                        notes: `Sincronizado desde Sage300 - ${new Date().toISOString()}`
                    };
                    if (dryRun) {
                        logger.info(`[DRY-RUN] Case C — ${itemCode}: se crearía en ${fracttalWarehouse} y luego ajustaría stock a ${adjustmentData.stock}`);
                    } else {
                        logger.info(`Creando item: ${itemCode} en almacén ${fracttalWarehouse}`);
                        await fracttal.createInventoryWithWarehouse(createData);
                        await fracttal.adjustInventoryStock(itemCode, adjustmentData);
                    }
                    createdItems++;
                }

                preview.push({
                    itemCode,
                    description: sageItem.Description?.trim() || '',
                    sageLocation,
                    fracttalWarehouse,
                    case: caseLabel,
                    currentStockInWarehouse,
                    plannedStock: adjustmentData.stock,
                    plannedUnitCost: adjustmentData.unit_cost_stock,
                    plannedMin: adjustmentData.min_stock_level,
                    plannedMax: adjustmentData.max_stock_level
                });

                processedItems++;

                // Log de progreso cada 100 items
                if (processedItems % 100 === 0) {
                    logger.info(`${tag}Progreso: ${processedItems}/${sageItems.length} items procesados`);
                }

            } catch (itemError) {
                errors++;
                logger.error(`${tag}Error procesando item ${sageItem.ItemNumber}:`, itemError.message);

                // No detener el proceso por errores individuales
                continue;
            }
        }

        // Conteo por caso para el resumen
        const caseCounts = preview.reduce((acc, p) => {
            acc[`case${p.case}`] = (acc[`case${p.case}`] || 0) + 1;
            return acc;
        }, { caseA: 0, caseB: 0, caseC: 0 });

        const summary = {
            dryRun,
            totalItems: sageItems.length,
            processedItems,
            updatedItems,
            createdItems,
            errors,
            warehousesCreated,
            warehousesMissing,
            caseCounts,
            preview
        };

        logger.info('='.repeat(60));
        logger.info(dryRun ? '[DRY-RUN] RESUMEN DE LA SIMULACIÓN:' : 'RESUMEN DE SINCRONIZACIÓN:');
        logger.info(`- Total items en Sage300 (tras filtros): ${summary.totalItems}`);
        logger.info(`- Items procesados: ${summary.processedItems}`);
        logger.info(`- Case A (existe + en almacén → ajustar stock): ${caseCounts.caseA}`);
        logger.info(`- Case B (existe sin almacén → asociar+ajustar): ${caseCounts.caseB}`);
        logger.info(`- Case C (nuevo → crear+ajustar): ${caseCounts.caseC}`);
        logger.info(`- Errores: ${summary.errors}`);
        if (warehousesCreated.length > 0) {
            logger.info(`- Almacenes verificados${dryRun ? '' : '/creados'}: ${warehousesCreated.join(', ')}`);
        }
        if (warehousesMissing.length > 0) {
            logger.info(`- Almacenes faltantes (se crearían en modo real): ${warehousesMissing.join(', ')}`);
        }
        logger.info('='.repeat(60));

        if (dryRun) {
            logger.info('[DRY-RUN] Simulación completada — no se realizó ninguna escritura a Fracttal');
        } else {
            logger.info('Proceso de sincronización de inventario completado exitosamente');
        }
        return summary;

    } catch (error) {
        logger.error(`${tag}Error en la sincronización de inventario:`, error);
        throw error;
    }
}

async function start() {
    // LIC-01 + ENF-03: Startup license gate with retry + exit logic
    await validateLicense({ startup: true });
    // Programar tarea para ejecutarse todos los días a las 2am
    cron.schedule(process.env.SYNC_CRON_SCHEDULE || '0 2 * * *', syncInventory);
    if (require.main === module) {
        syncInventory();
    }
}

start().catch((err) => {
    logger.error('Fatal startup error:', err);
    process.exit(1);
});

// Exportar para uso manual si es necesario
module.exports = { syncInventory };
