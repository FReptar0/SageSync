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

async function syncInventory() {
    try {
        // LIC-02: Re-validate license on each sync cycle (periodic, no startup flag)
        await validateLicense();
        if (!isValid()) {
            logger.error('License invalid — aborting sync');
            return;
        }

        logger.info('Iniciando proceso de sincronización de inventario...');

        // Validar configuración
        configManager.validateConfig();
        logger.info('Configuración validada exitosamente');

        // Validar conexiones
        const sageConnected = await sage.validateConnection();
        const fracttalAuthenticated = await fracttal.getAccessToken();

        if (!sageConnected || !fracttalAuthenticated) {
            logger.error('No se pudo establecer conexión con Sage300 o autenticación con Fracttal');
            return;
        }

        // Obtener todos los items de inventario desde Sage300
        const sageItems = await sage.getAllInventoryItems();
        logger.info(`Se obtuvieron ${sageItems.length} items desde Sage300`);

        let processedItems = 0;
        let updatedItems = 0; // Items que se ajustaron (ya existían en el almacén)
        let createdItems = 0; // Items que se crearon o asociaron al almacén
        let errors = 0;
        let warehousesCreated = [];

        for (const sageItem of sageItems) {
            try {
                const itemCode = sageItem.ItemNumber?.trim();
                const sageLocation = sageItem.Location?.trim();

                if (!itemCode || !sageLocation) {
                    logger.warn(`Item sin código o ubicación válida: ${JSON.stringify(sageItem)}`);
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
                    logger.warn(`Ubicación ${sageLocation} no soportada para item ${itemCode} - saltando`);
                    continue;
                }

                // Asegurar que el almacén existe (crear si es necesario)
                try {
                    await fracttal.ensureWarehouseExists(fracttalWarehouse);
                    if (!warehousesCreated.includes(fracttalWarehouse)) {
                        warehousesCreated.push(fracttalWarehouse);
                    }
                } catch (warehouseError) {
                    logger.error(`Error asegurando que el almacén ${fracttalWarehouse} existe:`, warehouseError.message);
                    continue;
                }

                // Verificar si el item existe en Fracttal y está asociado al almacén
                const itemStatus = await fracttal.checkItemExistsInWarehouse(itemCode, fracttalWarehouse);

                // Datos de ajuste de inventario (stock, costo, min/max)
                const adjustmentData = {
                    code_warehouse: fracttalWarehouse,
                    stock: parseFloat(sageItem.QuantityOnHand) || 0,
                    unit_cost_stock: parseFloat(sageItem.LastCost) || 0,
                    min_stock_level: parseFloat(sageItem.MinimumStock) || 0,
                    max_stock_level: parseFloat(sageItem.MinimumStock) * 3 || 100
                };

                if (itemStatus.exists && itemStatus.inWarehouse) {
                    // CASE A: Item exists + in warehouse → adjust stock
                    logger.info(`Actualizando inventario: ${itemCode} en almacén ${fracttalWarehouse}`);

                    await fracttal.adjustInventoryStock(itemCode, adjustmentData);
                    updatedItems++;

                } else if (itemStatus.exists && !itemStatus.inWarehouse) {
                    // CASE B: Item exists but not in this warehouse → associate + adjust stock
                    logger.info(`Asociando item ${itemCode} al almacén ${fracttalWarehouse}`);

                    await fracttal.associateItemToWarehouse(itemCode, fracttalWarehouse, {
                        stock: 0,
                        unit_cost_stock: 0,
                        min_stock_level: adjustmentData.min_stock_level,
                        max_stock_level: adjustmentData.max_stock_level
                    });
                    await fracttal.adjustInventoryStock(itemCode, adjustmentData);
                    createdItems++;

                } else {
                    // CASE C: Item doesn't exist → create with warehouse + adjust stock
                    logger.info(`Creando item: ${itemCode} en almacén ${fracttalWarehouse}`);

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
                    await fracttal.createInventoryWithWarehouse(createData);
                    await fracttal.adjustInventoryStock(itemCode, adjustmentData);
                    createdItems++;
                }

                processedItems++;

                // Log de progreso cada 100 items
                if (processedItems % 100 === 0) {
                    logger.info(`Progreso: ${processedItems}/${sageItems.length} items procesados`);
                }

            } catch (itemError) {
                errors++;
                logger.error(`Error procesando item ${sageItem.ItemNumber}:`, itemError.message);

                // No detener el proceso por errores individuales
                continue;
            }
        }

        const summary = {
            totalItems: sageItems.length,
            processedItems,
            updatedItems,
            createdItems,
            errors,
            warehousesCreated
        };

        logger.info('='.repeat(60));
        logger.info('RESUMEN DE SINCRONIZACIÓN:');
        logger.info(`- Total items en Sage300: ${summary.totalItems}`);
        logger.info(`- Items procesados: ${summary.processedItems}`);
        logger.info(`- Items actualizados: ${summary.updatedItems}`);
        logger.info(`- Items creados/asociados: ${summary.createdItems}`);
        logger.info(`- Errores: ${summary.errors}`);
        if (warehousesCreated.length > 0) {
            logger.info(`- Almacenes verificados/creados: ${warehousesCreated.join(', ')}`);
        }
        logger.info('='.repeat(60));

        logger.info('Proceso de sincronización de inventario completado exitosamente');
        return summary;

    } catch (error) {
        logger.error('Error en la sincronización de inventario:', error);
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
