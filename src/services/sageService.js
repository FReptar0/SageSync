const database = require('../config/database');
const logger = require('../config/logger');
const ConfigManager = require('../config/configManager');

class SageService {
    constructor() {
        this.configManager = new ConfigManager();
    }

    /**
     * Construye el SELECT de inventario.
     * @param {Object} opts
     * @param {boolean} [opts.applyFilters=false] — si true, aplica inventoryFilters de config.json (familia + exclusión de segmentos). El path de sync usa true; el dashboard usa false.
     * @param {Array<{sql: string, name?: string, value?: any}>} [opts.extraWhere=[]] — condiciones adicionales para componer (ej. filtro por código/ubicación). Si name/value se proveen, se pasan como parámetros mssql.
     * @returns {{ query: string, parameters: Object }}
     */
    _buildInventoryQuery(opts = {}) {
        const { applyFilters = false, extraWhere = [] } = opts;

        const conditions = [
            'I.INACTIVE = 0',
            'I.STOCKITEM = 1',
            "B.LOCATION = 'GRAL'"
        ];
        const parameters = {};

        if (applyFilters) {
            const filters = this.configManager.getInventoryFilters();
            if (filters.itemBracketId) {
                conditions.push('I.ITEMBRKID = @itemBracketId');
                parameters.itemBracketId = filters.itemBracketId;
            }
            if (filters.segment1Excluded.length > 0) {
                const placeholders = filters.segment1Excluded
                    .map((_, idx) => `@seg1Excl${idx}`);
                conditions.push(`I.SEGMENT1 NOT IN (${placeholders.join(', ')})`);
                filters.segment1Excluded.forEach((value, idx) => {
                    parameters[`seg1Excl${idx}`] = value;
                });
            }
        }

        for (const w of extraWhere) {
            if (!w || !w.sql) continue;
            conditions.push(w.sql);
            if (w.name !== undefined && w.value !== undefined) {
                parameters[w.name] = w.value;
            }
        }

        const query = `
            SELECT
                I.FMTITEMNO     AS ItemNumber,
                I.[DESC]        AS Description,
                B.LOCATION      AS Location,
                ISNULL(B.QTYONHAND-B.QTYCOMMIT-B.QTYSHNOCST+B.QTYRENOCST+B.QTYADNOCST,0) AS QuantityOnHand,
                B.QTYMINREQ     AS MinimumStock,
                B.STDCOST       AS StandardCost,
                B.RECENTCOST    AS RecentCost,
                B.LASTCOST      AS LastCost
            FROM COPDAT.dbo.ICILOC AS B
            JOIN COPDAT.dbo.ICITEM AS I
                ON B.ITEMNO = I.ITEMNO
            WHERE ${conditions.join('\n                AND ')}
            ORDER BY B.ITEMNO, B.LOCATION
        `;

        return { query, parameters };
    }

    async getAllInventoryItems() {
        try {
            const { query, parameters } = this._buildInventoryQuery({ applyFilters: true });
            logger.info('Obteniendo todos los items de inventario desde Sage300 (con filtros de familia)...');
            const result = await database.query(query, parameters);
            logger.info(`Se obtuvieron ${result.recordset.length} items de inventario`);
            return result.recordset;
        } catch (error) {
            logger.error('Error obteniendo items de inventario:', error);
            throw error;
        }
    }

    /**
     * CARGA DIARIA / DELTA — query ENVIADO POR SANTIAGO (2026-08-06), usado tal cual.
     * Detecta "lo que se movió" vía ICIVAL (tabla de valuación): junta la valuación
     * por item y filtra con HAVING MAX(AUDTDATE) >= fecha de corte.
     *
     * NOTAS / DEUDA (diferencias vs. la carga inicial — decisión de Yahir: dejarlo tal cual):
     *  1. Stock = B.QTYONHAND (on-hand físico), NO el "disponible" que usa la carga
     *     inicial (getAllInventoryItems). => la inicial y la diaria mandan a Fracttal
     *     con criterios distintos; un item "salta" de disponible a on-hand al moverse.
     *  2. Fecha de corte = HOY, dinámica (GETDATE() del server SQL): cada día trae
     *     solo lo movido ese día. OJO: correcto SOLO si el sync corre el MISMO día
     *     DESPUÉS del cierre de fin de día. Si el cron corriera pasada la medianoche,
     *     se perdería lo del día anterior -> ahí habría que usar ventana (>= ayer).
     *     El cron aún no está apuntado al delta.
     *  3. Los filtros de familia (FSA + SEGMENT1) van QUEMADOS aquí; la carga inicial
     *     los lee de config.json (inventoryFilters). Hoy coinciden; si cambian en
     *     config, esta query NO los sigue.
     *  4. Único ajuste vs. lo que mandó Santiago: ICIVAL calificado como
     *     COPDAT.dbo.ICIVAL (el resto del código califica igual; sin prefijo puede
     *     no resolver según DB_NAME y tronar).
     */
    async getMovedInventoryItems() {
        try {
            const query = `
                SELECT
                    I.FMTITEMNO     AS ItemNumber,
                    I.[DESC]        AS Description,
                    B.LOCATION      AS Location,
                    B.QTYONHAND     AS QuantityOnHand,
                    B.QTYMINREQ     AS MinimumStock,
                    B.STDCOST       AS StandardCost,
                    B.RECENTCOST    AS RecentCost,
                    B.LASTCOST      AS LastCost
                FROM COPDAT.dbo.ICILOC AS B
                JOIN COPDAT.dbo.ICITEM AS I
                    ON B.ITEMNO = I.ITEMNO
                JOIN COPDAT.dbo.ICIVAL AS V
                    ON V.ITEMNO = I.ITEMNO
                WHERE I.INACTIVE  = 0
                  AND I.STOCKITEM = 1
                  AND B.LOCATION  = 'GRAL'
                  AND I.ITEMBRKID = 'FSA'
                  AND I.SEGMENT1 NOT IN ('001','002','004','005','006','018','019','035',
                                         '048','049','052','053','060','104','106','107')
                GROUP BY
                    I.FMTITEMNO,
                    I.[DESC],
                    B.LOCATION,
                    B.QTYONHAND,
                    B.QTYMINREQ,
                    B.STDCOST,
                    B.RECENTCOST,
                    B.LASTCOST
                HAVING MAX(V.AUDTDATE) >= CONVERT(int, CONVERT(char(8), GETDATE(), 112))  -- HOY, dinámico
                ORDER BY I.FMTITEMNO, B.LOCATION
            `;
            logger.info('Obteniendo items MOVIDOS de inventario desde Sage300 (carga diaria/delta - query de Santiago)...');
            const result = await database.query(query);
            logger.info(`Se obtuvieron ${result.recordset.length} items movidos de inventario`);
            return result.recordset;
        } catch (error) {
            logger.error('Error obteniendo items movidos de inventario:', error);
            throw error;
        }
    }

    async getInventoryItemsByLocation(location) {
        try {
            logger.info(`Obteniendo items de inventario para ubicación: ${location}`);
            // El dashboard browsea todo el inventario — no aplicamos inventoryFilters.
            const { query, parameters } = this._buildInventoryQuery({
                applyFilters: false,
                extraWhere: [{ sql: 'B.LOCATION = @location', name: 'location', value: location }]
            });
            const result = await database.query(query, parameters);
            logger.info(`Se obtuvieron ${result.recordset.length} items para la ubicación ${location}`);
            return result.recordset;
        } catch (error) {
            logger.error(`Error obteniendo items para ubicación ${location}:`, error);
            throw error;
        }
    }

    async getInventoryItemByCode(itemNumber, location = null) {
        try {
            // El dashboard busca por código formateado (FMTITEMNO) — sin filtros de familia.
            const extraWhere = [{ sql: 'I.FMTITEMNO = @itemNumber', name: 'itemNumber', value: itemNumber }];
            if (location) {
                extraWhere.push({ sql: 'B.LOCATION = @location', name: 'location', value: location });
            }
            const { query, parameters } = this._buildInventoryQuery({
                applyFilters: false,
                extraWhere
            });
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
                SELECT DISTINCT B.LOCATION
                FROM COPDAT.dbo.ICILOC AS B
                JOIN COPDAT.dbo.ICITEM AS I
                    ON B.ITEMNO = I.ITEMNO
                WHERE I.INACTIVE = 0
                    AND I.STOCKITEM = 1
                ORDER BY B.LOCATION
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
                    COUNT(DISTINCT B.LOCATION) as TotalLocations,
                    SUM(ISNULL(B.QTYONHAND-B.QTYCOMMIT-B.QTYSHNOCST+B.QTYRENOCST+B.QTYADNOCST,0)) as TotalQuantity,
                    AVG(B.LASTCOST) as AverageLastCost
                FROM COPDAT.dbo.ICILOC AS B
                JOIN COPDAT.dbo.ICITEM AS I
                    ON B.ITEMNO = I.ITEMNO
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
