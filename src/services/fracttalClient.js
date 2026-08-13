const axios = require('axios');
const logger = require('../config/logger');
const ConfigManager = require('../config/configManager');
require('dotenv').config();

// URL-encode any value that goes into a path segment. Defensive against
// item codes / warehouse codes that contain spaces, slashes, or unicode —
// surfaced during sandbox validation where codes like "Capstone Gold" 404'd
// because the space wasn't encoded.
const encPath = (v) => encodeURIComponent(String(v));

class FracttalClient {
    constructor() {
        this.baseURL = process.env.FRACTTAL_BASE_URL || 'https://app.fracttal.com/api';
        this.oauthURL = process.env.FRACTTAL_OAUTH_URL || 'https://one.fracttal.com/oauth/token';
        this.clientId = process.env.FRACTTAL_CLIENT_ID;
        this.clientSecret = process.env.FRACTTAL_CLIENT_SECRET;
        this.accessToken = null;
        this.refreshToken = null;
        this.tokenExpiry = null;
        this.configManager = new ConfigManager();

        this.client = axios.create({
            baseURL: this.baseURL,
            timeout: parseInt(process.env.SYNC_TIMEOUT) || 30000,
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            }
        });

        // Interceptor para agregar token automáticamente
        this.client.interceptors.request.use(async (config) => {
            const token = await this.getAccessToken();
            if (token) {
                config.headers.Authorization = `Bearer ${token}`;
            }
            return config;
        });

        // Interceptor para manejar errores de autenticación
        this.client.interceptors.response.use(
            (response) => response,
            async (error) => {
                const originalRequest = error.config;
                
                // Verificar si es error UNAUTHORIZED_ENDPOINT
                if (error.response && 
                    error.response.status === 401 && 
                    error.response.data?.message === 'UNAUTHORIZED_ENDPOINT') {
                    
                    const errorMsg = `🚫 ENDPOINT NO AUTORIZADO: ${originalRequest.url}`;
                    console.error(errorMsg);
                    console.error('💡 Este endpoint no está disponible con las credenciales actuales');
                    console.error('📞 Contacta a Fracttal para habilitar el módulo necesario');
                    
                    logger.error('UNAUTHORIZED_ENDPOINT detected', {
                        endpoint: originalRequest.url,
                        method: originalRequest.method,
                        message: 'Endpoint no autorizado - posible falta de permisos o módulo no habilitado'
                    });
                    
                    // No intentar renovar token para este tipo de error
                    const unauthorizedError = new Error(`Endpoint no autorizado: ${originalRequest.url}`);
                    unauthorizedError.isUnauthorizedEndpoint = true;
                    unauthorizedError.endpoint = originalRequest.url;
                    return Promise.reject(unauthorizedError);
                }
                
                // Manejo normal de errores 401 (token expirado)
                if (error.response && error.response.status === 401 && !originalRequest._retry) {
                    originalRequest._retry = true;
                    
                    console.log(`🔄 Token inválido (401), intentando renovar...`);
                    logger.warn('Token expirado, renovando...');

                    try {
                        // Limpiar token actual
                        this.accessToken = null;
                        this.tokenExpiry = null;
                        
                        // Obtener nuevo token
                        const newToken = await this.getAccessToken();
                        
                        if (newToken) {
                            originalRequest.headers.Authorization = `Bearer ${newToken}`;
                            console.log(`🔄 Reintentando petición con nuevo token...`);
                            return this.client.request(originalRequest);
                        }
                    } catch (retryError) {
                        console.error(`❌ Error obteniendo nuevo token:`, retryError.message);
                        logger.error('Error obteniendo nuevo token:', retryError.message);
                        return Promise.reject(retryError);
                    }
                }
                
                // Log del error para debug. Omitimos el 400 "ya asociado" porque se maneja
                // de forma idempotente aguas arriba (associateItemToWarehouse) — no es una falla.
                if (error.response) {
                    const bodyStr = JSON.stringify(error.response.data || '');
                    const yaAsociado = error.response.status === 400 && /associated before/i.test(bodyStr);
                    if (!yaAsociado) {
                        console.error(`❌ Error HTTP ${error.response.status}:`, error.response.data);
                    }
                } else {
                    console.error(`❌ Error de red:`, error.message);
                }
                
                return Promise.reject(error);
            }
        );
    }

    async authenticate() {
        try {
            // Primero intentar cargar token existente
            const existingToken = this.configManager.loadToken();
            if (existingToken) {
                this.accessToken = existingToken.access_token;
                this.refreshToken = existingToken.refresh_token;
                this.tokenExpiry = new Date(existingToken.expires_at);
                
                const now = new Date();
                const timeUntilExpiry = this.tokenExpiry.getTime() - now.getTime();
                const minutesUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60));
                
                console.log(`🔑 Token cargado desde archivo`);
                console.log(`📅 Expira: ${this.tokenExpiry.toISOString()}`);
                console.log(`⏰ Tiempo restante: ${minutesUntilExpiry} minutos`);
                
                if (timeUntilExpiry > 0) {
                    logger.info('Token cargado desde archivo, válido hasta:', this.tokenExpiry.toISOString());
                    return this.accessToken;
                } else {
                    console.log(`⚠️  Token expirado hace ${Math.abs(minutesUntilExpiry)} minutos, necesita renovación`);
                    // Token expirado, limpiar y continuar con nueva autenticación
                    this.accessToken = null;
                    this.refreshToken = null;
                    this.tokenExpiry = null;
                }
            }

            console.log(`🔐 Obteniendo nuevo token de acceso...`);
            logger.info('Autenticando con Fracttal API usando Client Credentials...');

            const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

            const response = await axios.post(this.oauthURL, 'grant_type=client_credentials', {
                headers: {
                    'Authorization': `Basic ${credentials}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });

            this.accessToken = response.data.access_token;
            this.refreshToken = response.data.refresh_token || null;
            this.tokenExpiry = new Date(Date.now() + ((response.data.expires_in || 7200) * 1000));

            // Guardar token en archivo
            this.configManager.saveToken(response.data);

            console.log(`✅ Nueva autenticación exitosa`);
            console.log(`📅 Token expira: ${this.tokenExpiry.toISOString()}`);
            logger.info('Autenticación exitosa con Fracttal');
            logger.info(`Token expira en: ${this.tokenExpiry.toISOString()}`);

            return this.accessToken;
        } catch (error) {
            const errorDetails = {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                message: error.message
            };
            console.error(`❌ Error en autenticación:`, errorDetails);
            logger.error('Error en autenticación con Fracttal:', errorDetails);
            throw error;
        }
    }

    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('No hay refresh token disponible');
        }

        try {
            logger.info('Renovando token de acceso...');
            console.log(`🔄 Intentando renovar token...`);

            const credentials = Buffer.from(`${this.clientId}:${this.clientSecret}`).toString('base64');

            const response = await axios.post(
                this.oauthURL,
                `grant_type=refresh_token&refresh_token=${this.refreshToken}`,
                {
                    headers: {
                        'Authorization': `Basic ${credentials}`,
                        'Content-Type': 'application/x-www-form-urlencoded'
                    }
                }
            );

            this.accessToken = response.data.access_token;
            this.refreshToken = response.data.refresh_token || this.refreshToken;
            this.tokenExpiry = new Date(Date.now() + ((response.data.expires_in || 7200) * 1000));

            // Guardar el nuevo token
            this.configManager.saveToken(response.data);

            logger.info('Token renovado exitosamente');
            console.log(`✅ Token renovado exitosamente. Expira: ${this.tokenExpiry.toISOString()}`);
            return this.accessToken;
        } catch (error) {
            const errorDetails = {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                message: error.message
            };
            logger.error('Error renovando token:', errorDetails);
            console.error(`❌ Error renovando token:`, errorDetails);
            throw error;
        }
    }

    async getAccessToken() {
        // Verificar si ya tenemos un token válido
        if (this.accessToken && this.tokenExpiry) {
            const now = new Date();
            const timeUntilExpiry = this.tokenExpiry.getTime() - now.getTime();
            const minutesUntilExpiry = Math.floor(timeUntilExpiry / (1000 * 60));
            
            // Si el token expira en más de 5 minutos, está bien usarlo
            if (timeUntilExpiry > (5 * 60 * 1000)) {
                return this.accessToken;
            }
            
            console.log(`⚠️  Token expira en ${minutesUntilExpiry} minutos, necesita renovación`);
        }
        
        // Token no existe o está próximo a expirar, autenticar
        await this.authenticate();
        return this.accessToken;
    }

    async getWarehouses() {
        try {
            logger.info('Obteniendo almacenes de Fracttal...');
            const response = await this.client.get('/warehouses');
            return response.data;
        } catch (error) {
            logger.error('Error obteniendo almacenes:', error.response?.data || error.message);
            throw error;
        }
    }

    async getWarehouseItems(warehouseId, page = 1, limit = 100) {
        try {
            logger.info(`Obteniendo items del almacén ${warehouseId}, página ${page}...`);
            const response = await this.client.get(`/warehouses/${warehouseId}/items`, {
                params: { page, limit }
            });
            return response.data;
        } catch (error) {
            logger.error('Error obteniendo items del almacén:', error.response?.data || error.message);
            throw error;
        }
    }

    // DEPRECATED: Métodos antiguos - usar createInventoryItem y updateInventoryAdjustment
    async createWarehouseItem(warehouseId, itemData) {
        logger.warn('DEPRECATED: createWarehouseItem - usar createInventoryItem en su lugar');
        return await this.createInventoryItem(itemData);
    }

    async updateWarehouseItem(warehouseId, itemId, itemData) {
        logger.warn('DEPRECATED: updateWarehouseItem - usar updateInventoryAdjustment en su lugar');
        const adjustmentData = this.prepareFracttalAdjustmentData(itemData, warehouseId);
        return await this.updateInventoryAdjustment(itemId, adjustmentData);
    }

    async searchWarehouseItem(warehouseId, code) {
        try {
            const response = await this.client.get(`/items`, {
                params: {
                    code: code,
                    limit: 1
                }
            });
            return response.data.data && response.data.data.length > 0 ? response.data.data[0] : null;
        } catch (error) {
            logger.error('Error buscando item:', error.response?.data || error.message);
            return null;
        }
    }

    // DEPRECATED: Método antiguo - usar updateInventoryAdjustment
    async adjustInventory(warehouseId, itemId, quantity, reason = 'Sincronización Sage300') {
        logger.warn('DEPRECATED: adjustInventory - usar updateInventoryAdjustment en su lugar');
        const adjustmentData = {
            code_warehouse: warehouseId,
            stock: quantity,
            unit_cost_stock: 0 // Valor por defecto, debería venir de los datos reales
        };
        return await this.updateInventoryAdjustment(itemId, adjustmentData);
    }

    // Métodos para consultar almacenes e inventarios según documentación oficial
    async getWarehouseByCode(code, params = {}) {
        try {
            console.log(`🔍 Consultando almacén con código: ${code}`);
            logger.info(`Consultando almacén con código: ${code}`);
            const response = await this.client.get(`/warehouses/${encPath(code)}`, { params });
            console.log(`✅ Almacén ${code} encontrado`);
            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log(`📭 Almacén ${code} no encontrado (404)`);
                logger.info(`Almacén ${code} no encontrado`);
            } else {
                console.error(`❌ Error consultando almacén ${code}:`, error.response?.data || error.message);
                logger.error('Error consultando almacén:', error.response?.data || error.message);
            }
            throw error;
        }
    }

    async getAllWarehouses(params = {}) {
        try {
            logger.info('Consultando todos los almacenes');
            const response = await this.client.get('/warehouses', { params });
            return response.data;
        } catch (error) {
            logger.error('Error consultando almacenes:', error.response?.data || error.message);
            throw error;
        }
    }

    async getInventoryByCode(code) {
        try {
            logger.info(`Consultando item con código: ${code}`);
            const response = await this.client.get(`/items/${encPath(code)}`);
            return response.data;
        } catch (error) {
            logger.error('Error consultando item:', error.response?.data || error.message);
            throw error;
        }
    }

    async getAllInventories(params = {}) {
        try {
            logger.info('Consultando todos los items');
            const response = await this.client.get('/items', { params });
            return response.data;
        } catch (error) {
            logger.error('Error consultando items:', error.response?.data || error.message);
            throw error;
        }
    }

    // Métodos para sincronización según documentación oficial de Fracttal
    
    // Crear un activo (item) según documentación oficial
    async createInventoryItem(itemData) {
        try {
            logger.info(`Creando item ${itemData.code}`);
            
            // Validar campos requeridos según documentación
            if (!itemData.code || !itemData.id_type_item || !itemData.field_1) {
                throw new Error('Faltan campos requeridos: code, id_type_item, field_1');
            }
            
            // Para repuestos y herramientas, unit_code y unit_description son obligatorios
            if ((itemData.id_type_item === 3 || itemData.id_type_item === 4) && 
                (!itemData.unit_code || !itemData.unit_description)) {
                throw new Error('Para repuestos/herramientas son requeridos: unit_code, unit_description');
            }
            
            const response = await this.client.post('/items/', itemData);
            logger.info(`Item ${itemData.code} creado exitosamente`);
            return response.data;
        } catch (error) {
            logger.error('Error creando item:', error.response?.data || error.message);
            throw error;
        }
    }
    
    // Actualizar un activo (item) según documentación oficial
    // https://api.fracttal.com/reference/actualizar-un-activo
    async updateInventoryItem(itemCode, itemData) {
        try {
            logger.info(`Actualizando item ${itemCode}`);
            
            // Validar que code y id_type_item estén presentes (requeridos por Fracttal)
            if (!itemData.id_type_item) {
                throw new Error('id_type_item es requerido para actualizar un item');
            }
            
            // Nota: Según documentación, enviar solo los parámetros que se desean actualizar
            const response = await this.client.put(`/items/${encPath(itemCode)}`, itemData);
            logger.info(`Item ${itemCode} actualizado exitosamente`);
            return response.data;
        } catch (error) {
            logger.error('Error actualizando item:', error.response?.data || error.message);
            throw error;
        }
    }
    
    // Método alternativo usando ID numérico de Fracttal en lugar de código
    async updateInventoryItemById(itemId, itemData) {
        try {
            logger.info(`Actualizando item por ID: ${itemId}`);
            
            if (!itemData.id_type_item) {
                throw new Error('id_type_item es requerido para actualizar un item');
            }
            
            const response = await this.client.put(`/items/?id_fracttal=${itemId}`, itemData);
            logger.info(`Item ID ${itemId} actualizado exitosamente`);
            return response.data;
        } catch (error) {
            logger.error('Error actualizando item por ID:', error.response?.data || error.message);
            throw error;
        }
    }

    // =====================================================================
    // WAREHOUSE INVENTORY METHODS (POST /inventories/, etc.)
    // These use the correct endpoints for warehouse-associated inventory
    // =====================================================================

    // Create item AND associate it to a warehouse in one call
    // POST /inventories/ - Creates item with warehouse association and stock
    async createInventoryWithWarehouse(itemData) {
        try {
            logger.info(`Creando item ${itemData.code} en almacén ${itemData.code_warehouse || itemData.id_warehouse}`);

            if (!itemData.code || !itemData.field_1 || !itemData.unit_code || !itemData.unit_description) {
                throw new Error('Faltan campos requeridos: code, field_1, unit_code, unit_description');
            }

            if (!itemData.code_warehouse && !itemData.id_warehouse) {
                throw new Error('Se requiere code_warehouse o id_warehouse para asociar a un almacén');
            }

            const response = await this.client.post('/inventories/', itemData);
            logger.info(`Item ${itemData.code} creado y asociado a almacén exitosamente`);
            return response.data;
        } catch (error) {
            logger.error('Error creando item con almacén:', error.response?.data || error.message);
            throw error;
        }
    }

    // Associate an existing item to a warehouse
    // POST /inventories_associate_warehouse/
    async associateItemToWarehouse(code, warehouseCode, stockData = {}) {
        try {
            logger.info(`Asociando item ${code} al almacén ${warehouseCode}`);

            const payload = {
                code,
                code_warehouse: warehouseCode,
                stock: stockData.stock || 0,
                unit_cost_stock: stockData.unit_cost_stock || 0,
                max_stock_level: stockData.max_stock_level || 0,
                min_stock_level: stockData.min_stock_level || 0,
                location: stockData.location || '',
                order_quantity: stockData.order_quantity || 0
            };

            const response = await this.client.post('/inventories_associate_warehouse/', payload);
            logger.info(`Item ${code} asociado al almacén ${warehouseCode} exitosamente`);
            return response.data;
        } catch (error) {
            // Idempotencia: si el item YA estaba asociado a este almacén, Fracttal responde
            // con "...it was associated before...". NO es un error real: la detección de caso
            // (checkItemExistsInWarehouse, vía /items/) a veces no ve la asociación existente
            // y clasifica como Case B. Tratamos "ya asociado" como éxito para continuar al
            // ajuste de stock (resultado equivalente a Case A).
            // TODO: arreglo de fondo — que checkItemExistsInWarehouse use /inventories/{code}.
            const msg = JSON.stringify(error.response?.data || error.message || '');
            if (/associated before/i.test(msg)) {
                logger.warn(`Item ${code} ya estaba asociado al almacén ${warehouseCode} — se omite la asociación y se continúa al ajuste`);
                return { success: true, alreadyAssociated: true };
            }
            logger.error('Error asociando item a almacén:', error.response?.data || error.message);
            throw error;
        }
    }

    // Adjust stock for an item in a warehouse
    // PUT /inventories_adjustment/{code}
    async adjustInventoryStock(itemCode, warehouseData) {
        try {
            logger.info(`Ajustando inventario de ${itemCode} en almacén ${warehouseData.code_warehouse || warehouseData.id_warehouse}`);

            const response = await this.client.put(`/inventories_adjustment/${encPath(itemCode)}`, warehouseData);
            logger.info(`Inventario de ${itemCode} ajustado exitosamente`);
            return response.data;
        } catch (error) {
            logger.error('Error ajustando inventario:', error.response?.data || error.message);
            throw error;
        }
    }

    // Query all items and stock in a specific warehouse
    // GET /warehouses_items/{code}
    async getWarehouseStock(warehouseCode, params = {}) {
        try {
            logger.info(`Consultando stock del almacén ${warehouseCode}`);
            const response = await this.client.get(`/warehouses_items/`, {
                params: { code: warehouseCode, ...params }
            });
            return response.data;
        } catch (error) {
            logger.error('Error consultando stock de almacén:', error.response?.data || error.message);
            throw error;
        }
    }

    // Query an item with its warehouse associations and stock
    // GET /inventories/{code}
    async getItemInventory(itemCode) {
        try {
            logger.info(`Consultando inventario del item ${itemCode}`);
            const response = await this.client.get(`/inventories/${encPath(itemCode)}`);
            return response.data;
        } catch (error) {
            logger.error('Error consultando inventario del item:', error.response?.data || error.message);
            throw error;
        }
    }

    // Create a warehouse entry (incoming goods)
    // POST /warehouse_entries_orders/{warehouse_code}
    async createWarehouseEntry(warehouseCode, entryData) {
        try {
            logger.info(`Creando entrada al almacén ${warehouseCode}`);

            if (!entryData.movement_type || !entryData.document || !entryData.code_user || !entryData.items) {
                throw new Error('Faltan campos requeridos: movement_type, document, code_user, items');
            }

            const response = await this.client.post(`/warehouse_entries_orders/${encPath(warehouseCode)}`, entryData);
            logger.info(`Entrada al almacén ${warehouseCode} creada exitosamente`);
            return response.data;
        } catch (error) {
            logger.error('Error creando entrada de almacén:', error.response?.data || error.message);
            throw error;
        }
    }

    // Create a warehouse exit (outgoing goods)
    // POST /warehouse_outputs_orders/
    async createWarehouseExit(exitData) {
        try {
            logger.info(`Creando salida de almacén ${exitData.warehouse_code}`);

            if (!exitData.warehouse_code || !exitData.responsible_code || !exitData.id_movement_type) {
                throw new Error('Faltan campos requeridos: warehouse_code, responsible_code, id_movement_type');
            }

            const response = await this.client.post('/warehouse_outputs_orders/', exitData);
            logger.info(`Salida de almacén ${exitData.warehouse_code} creada exitosamente`);
            return response.data;
        } catch (error) {
            logger.error('Error creando salida de almacén:', error.response?.data || error.message);
            throw error;
        }
    }

    // Alias para compatibilidad con código existente
    async updateInventoryAdjustment(itemCode, adjustmentData) {
        logger.warn('updateInventoryAdjustment is deprecated - using adjustInventoryStock instead');
        return await this.adjustInventoryStock(itemCode, adjustmentData);
    }

    async checkItemExistsInWarehouse(itemCode, warehouseCode) {
        try {
            // Intentar obtener el item específico
            const itemDetail = await this.getInventoryByCode(itemCode);

            if (!itemDetail.success || !itemDetail.data || itemDetail.data.length === 0) {
                return { exists: false, inWarehouse: false, itemData: null };
            }

            const item = Array.isArray(itemDetail.data) ? itemDetail.data[0] : itemDetail.data;

            // Verificar si está asociado al almacén específico
            const inWarehouse = item.warehouses && Array.isArray(item.warehouses) &&
                item.warehouses.some(wh => wh.code_warehouse === warehouseCode);

            return {
                exists: true,
                inWarehouse: inWarehouse,
                itemData: item,
                warehouseData: inWarehouse ?
                    item.warehouses.find(wh => wh.code_warehouse === warehouseCode) : null
            };
        } catch (error) {
            if (error.response && error.response.status === 404) {
                return { exists: false, inWarehouse: false, itemData: null };
            }
            logger.error('Error verificando existencia del item:', error.response?.data || error.message);
            throw error;
        }
    }
    
    // Método auxiliar para crear item si no existe
    async createItemIfNotExists(itemCode, warehouseCode, sageItemData) {
        const itemStatus = await this.checkItemExistsInWarehouse(itemCode, warehouseCode);
        
        if (!itemStatus.exists) {
            // El item no existe, crearlo
            const createData = this.prepareFracttalCreateData(sageItemData, warehouseCode);
            return await this.createInventoryItem(createData);
        }
        
        return itemStatus;
    }
    
    // Preparar datos para crear item en Fracttal
    prepareFracttalCreateData(sageItem, warehouseCode) {
        return {
            code: sageItem.ItemNumber?.trim(),
            field_1: sageItem.Description?.trim() || sageItem.ItemNumber?.trim(), // Nombre (requerido)
            field_2: '', // Número de parte (opcional)
            field_3: '', // Fabricante (opcional)
            field_4: '', // Modelo (opcional)
            field_5: '', // Otro 1 (opcional)
            field_6: '', // Otro 2 (opcional)
            id_type_item: 4, // 4 = Repuesto y suministro (valor por defecto)
            code_warehouse: warehouseCode,
            location: sageItem.Location?.trim() || '',
            max_stock_level: parseFloat(sageItem.MinimumStock) * 3 || 100,
            min_stock_level: parseFloat(sageItem.MinimumStock) || 0,
            stock: parseFloat(sageItem.QuantityOnHand) || 0,
            unit_cost_stock: parseFloat(sageItem.LastCost) || 0,
            unit_code: 'UN', // Código de unidad (requerido)
            unit_description: 'Unidad', // Descripción de unidad (requerido)
            visible_to_all: false,
            barcode: sageItem.ItemNumber?.trim() || '',
            notes: `Sincronizado desde Sage300 - ${new Date().toISOString()}`
        };
    }
    
    // Preparar datos para ajuste de inventario
    prepareFracttalAdjustmentData(sageItem, warehouseCode) {
        return {
            code: sageItem.ItemNumber?.trim(),
            id_type_item: 4, // 4 = Repuesto y suministro
            code_warehouse: warehouseCode,
            stock: parseFloat(sageItem.QuantityOnHand) || 0,
            unit_cost_stock: parseFloat(sageItem.LastCost) || 0,
            min_stock_level: parseFloat(sageItem.MinimumStock) || 0,
            max_stock_level: parseFloat(sageItem.MinimumStock) * 3 || 100
        };
    }

    async createWarehouse(warehouseData) {
        try {
            // Validar datos requeridos
            if (!warehouseData.code || !warehouseData.description) {
                throw new Error('Code y description son requeridos para crear un almacén');
            }
            
            console.log(`🏗️  Creando almacén: ${warehouseData.code} - ${warehouseData.description}`);
            logger.info(`Creando almacén: ${warehouseData.code} - ${warehouseData.description}`);
            
            // Estructura según la documentación de Fracttal
            const warehousePayload = {
                code: warehouseData.code,
                description: warehouseData.description,
                address: warehouseData.address || '',
                state: warehouseData.state || '',
                city: warehouseData.city || '',
                country: warehouseData.country || '',
                zip_code: warehouseData.zip_code || '',
                external_integration: warehouseData.external_integration || false,
                transfer_approval: warehouseData.transfer_approval || false,
                active: warehouseData.active !== undefined ? warehouseData.active : true,
                visible_to_all: warehouseData.visible_to_all || false
            };
            
            console.log(`📋 Datos del almacén:`, warehousePayload);
            
            const response = await this.client.post('/warehouses/', warehousePayload);
            
            console.log(`✅ Almacén creado exitosamente: ${warehouseData.code}`);
            logger.info(`Almacén creado exitosamente: ${warehouseData.code}`);
            
            return response.data;
        } catch (error) {
            const errorDetails = {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                message: error.message
            };
            console.error(`❌ Error creando almacén:`, errorDetails);
            logger.error('Error creando almacén:', errorDetails);
            throw error;
        }
    }

    async ensureWarehouseExists(warehouseCode) {
        try {
            console.log(`🔍 Verificando si almacén ${warehouseCode} existe...`);
            
            // Primero verificar si el almacén existe
            const warehouse = await this.getWarehouseByCode(warehouseCode);
            if (warehouse && warehouse.success && warehouse.data) {
                console.log(`✅ Almacén ${warehouseCode} ya existe`);
                logger.info(`Almacén ${warehouseCode} ya existe`);
                return warehouse.data;
            }
        } catch (error) {
            // Verificar si es error UNAUTHORIZED_ENDPOINT
            if (error.isUnauthorizedEndpoint) {
                const errorMsg = `🚫 MÓDULO DE ALMACENES NO HABILITADO: No se puede acceder a /warehouses/${warehouseCode}`;
                console.error(errorMsg);
                console.error('📞 Solución: Contacta a Fracttal para habilitar el módulo de Inventarios/Almacenes');
                logger.error('Warehouse module not enabled', { warehouseCode, endpoint: error.endpoint });
                throw new Error(`Módulo de almacenes no habilitado en tu cuenta de Fracttal. Contacta soporte.`);
            }
            
            // Si es 404, el almacén no existe, continuar con la creación
            if (error.response && error.response.status !== 404) {
                console.error(`❌ Error verificando almacén ${warehouseCode}:`, error.message);
                throw error;
            }
            console.log(`📭 Almacén ${warehouseCode} no encontrado (404), procediendo a crear...`);
        }

        // Si llegamos aquí, el almacén no existe, crearlo
        const creationSettings = this.configManager.getWarehouseCreationSettings();
        if (!creationSettings.enabled) {
            const errorMsg = `Almacén ${warehouseCode} no encontrado y la creación automática está deshabilitada`;
            console.error(`❌ ${errorMsg}`);
            throw new Error(errorMsg);
        }

        console.log(`🏗️  Creando almacén ${warehouseCode} automáticamente...`);

        const warehouseData = {
            code: warehouseCode,
            description: creationSettings.descriptionTemplate.replace('{code}', warehouseCode),
            active: true,
            ...creationSettings.defaultValues
        };

        const newWarehouse = await this.createWarehouse(warehouseData);
        
        // Actualizar configuración con el nuevo almacén si es necesario
        const defaultWarehouse = this.configManager.getDefaultWarehouse();
        if (defaultWarehouse.code === warehouseCode) {
            console.log(`✅ Almacén por defecto ${warehouseCode} creado exitosamente`);
            logger.info(`Almacén por defecto ${warehouseCode} creado exitosamente`);
        }

        return newWarehouse;
    }

    async getWarehouseByCodeOrCreate(warehouseCode) {
        try {
            const warehouse = await this.getWarehouseByCode(warehouseCode);
            if (warehouse && warehouse.success && warehouse.data) {
                return warehouse.data;
            }
        } catch (error) {
            if (error.response && error.response.status !== 404) {
                throw error;
            }
        }

        // Si no existe, intentar crearlo
        return await this.ensureWarehouseExists(warehouseCode);
    }
}

module.exports = FracttalClient;
