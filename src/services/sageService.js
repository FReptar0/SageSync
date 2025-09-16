const database = require('../config/database');
const logger = require('../config/logger');
const ConfigManager = require('../config/configManager');

class SageService {
    constructor() {
        this.configManager = new ConfigManager();
        this.inventoryQuery = `
            SELECT
                L.ITEMNO        AS ItemNumber,
                I.[DESC]        AS Description,
                L.LOCATION      AS Location,
                L.QTYONHAND     AS QuantityOnHand,
                L.QTYMINREQ     AS MinimumStock,
                L.STDCOST       AS StandardCost,
                L.RECENTCOST    AS RecentCost,
                L.LASTCOST      AS LastCost
            FROM COPDAT.dbo.ICILOC AS L
            JOIN COPDAT.dbo.ICITEM AS I
                ON L.ITEMNO = I.ITEMNO
            WHERE I.INACTIVE = 0
                AND I.STOCKITEM = 1
                AND L.LOCATION = 'GRAL'
            ORDER BY L.ITEMNO, L.LOCATION
        `;
    }

    async getAllInventoryItems() {
        try {
            logger.info('Obteniendo todos los items de inventario desde Sage300...');
            const result = await database.query(this.inventoryQuery);
            logger.info(`Se obtuvieron ${result.recordset.length} items de inventario`);
            return result.recordset;
        } catch (error) {
            logger.error('Error obteniendo items de inventario:', error);
            throw error;
        }
    }

    async getInventoryItemsByLocation(location) {
        try {
            logger.info(`Obteniendo items de inventario para ubicación: ${location}`);
            const query = this.inventoryQuery + ' AND L.LOCATION = @location';
            const result = await database.query(query, { location });
            logger.info(`Se obtuvieron ${result.recordset.length} items para la ubicación ${location}`);
            return result.recordset;
        } catch (error) {
            logger.error(`Error obteniendo items para ubicación ${location}:`, error);
            throw error;
        }
    }

    async getInventoryItemByCode(itemNumber, location = null) {
        try {
            let query = this.inventoryQuery + ' AND L.ITEMNO = @itemNumber';
            let parameters = { itemNumber };
            
            if (location) {
                query += ' AND L.LOCATION = @location';
                parameters.location = location;
            }

            const result = await database.query(query, parameters);
            return result.recordset.length > 0 ? result.recordset[0] : null;
        } catch (error) {
            logger.error(`Error obteniendo item ${itemNumber}:`, error);
            throw error;
        }
    }

    async getUniqueLocations() {
        try {
            logger.info('Obteniendo ubicaciones únicas desde Sage300...');
            const query = `
                SELECT DISTINCT L.LOCATION
                FROM COPDAT.dbo.ICILOC AS L
                JOIN COPDAT.dbo.ICITEM AS I
                    ON L.ITEMNO = I.ITEMNO
                WHERE I.INACTIVE = 0
                    AND I.STOCKITEM = 1
                ORDER BY L.LOCATION
            `;
            const result = await database.query(query);
            logger.info(`Se encontraron ${result.recordset.length} ubicaciones únicas`);
            return result.recordset.map(row => row.LOCATION);
        } catch (error) {
            logger.error('Error obteniendo ubicaciones:', error);
            throw error;
        }
    }

    async getInventoryStats() {
        try {
            logger.info('Obteniendo estadísticas de inventario...');
            const query = `
                SELECT 
                    COUNT(*) as TotalItems,
                    COUNT(DISTINCT L.LOCATION) as TotalLocations,
                    SUM(L.QTYONHAND) as TotalQuantity,
                    AVG(L.LASTCOST) as AverageLastCost
                FROM COPDAT.dbo.ICILOC AS L
                JOIN COPDAT.dbo.ICITEM AS I
                    ON L.ITEMNO = I.ITEMNO
                WHERE I.INACTIVE = 0
                    AND I.STOCKITEM = 1
            `;
            const result = await database.query(query);
            return result.recordset[0];
        } catch (error) {
            logger.error('Error obteniendo estadísticas:', error);
            throw error;
        }
    }

    async getLastSyncInfo() {
        try {
            // Obtener información de la última sincronización
            // Podrías crear una tabla para trackear esto
            const query = `
                SELECT TOP 1
                    GETDATE() as CurrentTime,
                    'Sage300' as Source
            `;
            const result = await database.query(query);
            return result.recordset[0];
        } catch (error) {
            logger.error('Error obteniendo info de última sync:', error);
            throw error;
        }
    }

    transformToFracttalFormat(sageItem) {
        return {
            code: sageItem.ItemNumber?.trim(),
            name: sageItem.Description?.trim() || sageItem.ItemNumber?.trim(),
            description: sageItem.Description?.trim(),
            location: sageItem.Location?.trim(),
            quantity: parseFloat(sageItem.QuantityOnHand) || 0,
            minimum_stock: parseFloat(sageItem.MinimumStock) || 0,
            cost: parseFloat(sageItem.LastCost) || 0,
            unit_of_measure: 'UN', // Valor por defecto, ajustar según necesidades
            category: 'Inventory', // Valor por defecto
            sync_source: 'Sage300',
            sync_date: new Date().toISOString()
        };
    }

    // Nuevo método para mapear según documentación de Fracttal
    transformToFracttalInventoryFormat(sageItem, warehouseCode) {
        return {
            // Datos requeridos por Fracttal API
            stock: parseFloat(sageItem.QuantityOnHand) || 0,
            unit_cost_stock: parseFloat(sageItem.LastCost) || 0,
            min_stock_level: parseFloat(sageItem.MinimumStock) || 0,
            max_stock_level: parseFloat(sageItem.MinimumStock) * 3 || 100, // Asumiendo max = min * 3
            location: sageItem.Location?.trim() || '',
            reorder_level: parseFloat(sageItem.MinimumStock) || 1,
            
            // Metadata adicional
            sync_source: 'Sage300',
            sync_date: new Date().toISOString(),
            sage_last_cost: parseFloat(sageItem.LastCost) || 0
        };
    }

    // Método para obtener mapeo de ubicación Sage -> Almacén Fracttal  
    mapSageLocationToFracttalWarehouse(sageLocation, itemCode = '', description = '') {
        // Usar configuración para obtener el mapeo
        const mapping = this.configManager.getLocationMapping(sageLocation);
        
        if (!mapping) {
            logger.warn(`No se encontró mapeo para la ubicación: ${sageLocation}`);
            return null;
        }

        // Si no hay reglas especiales, usar el almacén por defecto
        if (!mapping.specialRules || !Array.isArray(mapping.specialRules)) {
            logger.info(`📦 Item de ${sageLocation} -> ${mapping.fracttalWarehouseCode} (mapeo directo)`);
            return mapping.fracttalWarehouseCode;
        }

        // Aplicar reglas especiales basadas en la descripción
        const upperDescription = description.toUpperCase();
        const upperItemCode = itemCode.toUpperCase();

        for (const rule of mapping.specialRules) {
            const keywords = rule.keywords || [];
            
            // Verificar keywords en descripción o código
            const matchesKeyword = keywords.some(keyword => 
                upperDescription.includes(keyword.toUpperCase()) || 
                upperItemCode.includes(keyword.toUpperCase())
            );

            if (matchesKeyword) {
                logger.info(`🎯 Regla especial aplicada: ${rule.name} -> ${rule.fracttalWarehouseCode}`);
                return rule.fracttalWarehouseCode;
            }
        }

        // Si no coincide con ninguna regla especial, usar el almacén por defecto
        logger.info(`📦 Item de ${sageLocation} -> ${mapping.fracttalWarehouseCode} (por defecto)`);
        return mapping.fracttalWarehouseCode;
    }

    // Método para obtener todas las configuraciones de mapeo
    getLocationMappingInfo() {
        const allMappings = this.configManager.getAllLocationMappings();
        const defaultWarehouse = this.configManager.getDefaultWarehouse();
        
        return {
            locationMappings: allMappings,
            defaultWarehouse: defaultWarehouse,
            supportedLocations: Object.keys(allMappings),
            syncSettings: this.configManager.getSyncSettings()
        };
    }

    async validateConnection() {
        try {
            const isConnected = await database.testConnection();
            if (isConnected) {
                logger.info('Conexión a Sage300 validada exitosamente');
                return true;
            } else {
                logger.error('Falló la validación de conexión a Sage300');
                return false;
            }
        } catch (error) {
            logger.error('Error validando conexión a Sage300:', error);
            return false;
        }
    }

    async getConnectionInfo() {
        try {
            // Obtener información de la conexión actual
            const query = `
                SELECT 
                    DB_NAME() as CurrentDatabase,
                    @@SERVERNAME as ServerName,
                    @@VERSION as ServerVersion,
                    GETDATE() as CurrentTime,
                    USER_NAME() as CurrentUser
            `;
            const result = await database.query(query);
            const info = result.recordset[0];
            
            return {
                database: info.CurrentDatabase,
                server: info.ServerName,
                version: info.ServerVersion?.substring(0, 50) + '...', // Truncar versión
                currentUser: info.CurrentUser,
                connectionTime: info.CurrentTime
            };
        } catch (error) {
            logger.error('Error obteniendo información de conexión:', error);
            return null;
        }
    }
}

module.exports = SageService;
