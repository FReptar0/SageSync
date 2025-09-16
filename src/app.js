const SageService = require('./services/sageService');
const FracttalClient = require('./services/fracttalClient');
const ConfigManager = require('./config/configManager');
const cron = require('node-cron');
const logger = require('./config/logger');
require('dotenv').config();

const sage = new SageService();
const fracttal = new FracttalClient();
const configManager = new ConfigManager();

async function syncInventory() {
    try {
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
                
                if (itemStatus.exists && itemStatus.inWarehouse) {
                    // El item existe y está asociado al almacén - ACTUALIZAR con ajuste de inventario
                    logger.info(`Actualizando inventario existente: ${itemCode} en almacén ${fracttalWarehouse}`);
                    
                    const adjustmentData = fracttal.prepareFracttalAdjustmentData(sageItem, fracttalWarehouse);
                    await fracttal.updateInventoryAdjustment(itemCode, adjustmentData);
                    updatedItems++;
                    
                } else if (itemStatus.exists && !itemStatus.inWarehouse) {
                    // El item existe pero no está asociado al almacén - CREAR ASOCIACIÓN
                    logger.info(`Item ${itemCode} existe pero no está en almacén ${fracttalWarehouse} - creando asociación`);
                    
                    const createData = fracttal.prepareFracttalCreateData(sageItem, fracttalWarehouse);
                    await fracttal.createInventoryItem(createData);
                    createdItems++;
                    
                } else {
                    // El item no existe en Fracttal - CREAR NUEVO ITEM
                    logger.info(`Creando nuevo item: ${itemCode} en almacén ${fracttalWarehouse}`);
                    
                    const createData = fracttal.prepareFracttalCreateData(sageItem, fracttalWarehouse);
                    await fracttal.createInventoryItem(createData);
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

// Programar tarea para ejecutarse todos los días a las 2am
cron.schedule(process.env.SYNC_CRON_SCHEDULE || '0 2 * * *', syncInventory);

// Exportar para uso manual si es necesario
module.exports = { syncInventory };

// Ejecución directa para desarrollo
if (require.main === module) {
    syncInventory();
}
