const axios = require('axios');
const logger = require('../config/logger');
const ConfigManager = require('../config/configManager');
require('dotenv').config();

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
                
                // Log del error para debug
                if (error.response) {
                    console.error(`❌ Error HTTP ${error.response.status}:`, error.response.data);
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

    async createWarehouseItem(warehouseId, itemData) {
        try {
            logger.info(`Creando item en almacén ${warehouseId}: ${itemData.code}`);
            const response = await this.client.post(`/warehouses/${warehouseId}/items`, itemData);
            return response.data;
        } catch (error) {
            logger.error('Error creando item:', error.response?.data || error.message);
            throw error;
        }
    }

    async updateWarehouseItem(warehouseId, itemId, itemData) {
        try {
            logger.info(`Actualizando item ${itemId} en almacén ${warehouseId}`);
            const response = await this.client.put(`/warehouses/${warehouseId}/items/${itemId}`, itemData);
            return response.data;
        } catch (error) {
            logger.error('Error actualizando item:', error.response?.data || error.message);
            throw error;
        }
    }

    async searchWarehouseItem(warehouseId, code) {
        try {
            const response = await this.client.get(`/warehouses/${warehouseId}/items`, {
                params: {
                    search: code,
                    limit: 1
                }
            });
            return response.data.data && response.data.data.length > 0 ? response.data.data[0] : null;
        } catch (error) {
            logger.error('Error buscando item:', error.response?.data || error.message);
            return null;
        }
    }

    async adjustInventory(warehouseId, itemId, quantity, reason = 'Sincronización Sage300') {
        try {
            logger.info(`Ajustando inventario - Item: ${itemId}, Cantidad: ${quantity}`);
            const adjustmentData = {
                quantity: quantity,
                reason: reason,
                type: 'adjustment'
            };

            const response = await this.client.put(`/warehouses/${warehouseId}/items/${itemId}/adjust`, adjustmentData);
            return response.data;
        } catch (error) {
            logger.error('Error ajustando inventario:', error.response?.data || error.message);
            throw error;
        }
    }

    // Nuevos métodos para consultar almacenes e inventarios
    async getWarehouseByCode(code, params = {}) {
        try {
            console.log(`🔍 Consultando almacén con código: ${code}`);
            logger.info(`Consultando almacén con código: ${code}`);
            const response = await this.client.get(`/warehouses/${code}`, { params });
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
            logger.info(`Consultando inventario con código: ${code}`);
            const response = await this.client.get(`/inventories/${code}`);
            return response.data;
        } catch (error) {
            logger.error('Error consultando inventario:', error.response?.data || error.message);
            throw error;
        }
    }

    async getAllInventories(params = {}) {
        try {
            logger.info('Consultando todos los inventarios');
            const response = await this.client.get('/inventories', { params });
            return response.data;
        } catch (error) {
            logger.error('Error consultando inventarios:', error.response?.data || error.message);
            throw error;
        }
    }

    // Métodos para sincronización según documentación de Fracttal
    async updateInventoryItem(itemCode, warehouseCode, inventoryData) {
        try {
            logger.info(`Actualizando inventario ${itemCode} en almacén ${warehouseCode}`);
            const response = await this.client.put(`/inventories/${itemCode}`, {
                code: itemCode,
                code_warehouse: warehouseCode,
                ...inventoryData
            });
            return response.data;
        } catch (error) {
            logger.error('Error actualizando inventario:', error.response?.data || error.message);
            throw error;
        }
    }

    async associateItemToWarehouse(itemCode, warehouseCode, inventoryData) {
        try {
            logger.info(`Asociando item ${itemCode} al almacén ${warehouseCode}`);
            const response = await this.client.post('/inventories_associate_warehouse/', {
                code: itemCode,
                code_warehouse: warehouseCode,
                ...inventoryData
            });
            return response.data;
        } catch (error) {
            logger.error('Error asociando item al almacén:', error.response?.data || error.message);
            throw error;
        }
    }

    async checkItemExistsInWarehouse(itemCode, warehouseCode) {
        try {
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
