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
                if (error.response && error.response.status === 401) {
                    logger.warn('Token expirado, renovando...');

                    let newToken = null;
                    if (this.refreshToken) {
                        try {
                            newToken = await this.refreshAccessToken();
                        } catch (refreshError) {
                            logger.warn('Error renovando token, obteniendo nuevo token...');
                            this.refreshToken = null;
                        }
                    }

                    if (!newToken) {
                        this.accessToken = null;
                        this.tokenExpiry = null;
                        newToken = await this.getAccessToken();
                    }

                    if (newToken) {
                        error.config.headers.Authorization = `Bearer ${newToken}`;
                        return this.client.request(error.config);
                    }
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
                logger.info('Token cargado desde archivo, válido hasta:', this.tokenExpiry.toISOString());
                return this.accessToken;
            }

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

            logger.info('Autenticación exitosa con Fracttal');
            logger.info(`Token expira en: ${this.tokenExpiry.toISOString()}`);

            return this.accessToken;
        } catch (error) {
            logger.error('Error en autenticación con Fracttal:', {
                status: error.response?.status,
                statusText: error.response?.statusText,
                data: error.response?.data,
                message: error.message
            });
            throw error;
        }
    }

    async refreshAccessToken() {
        if (!this.refreshToken) {
            throw new Error('No hay refresh token disponible');
        }

        try {
            logger.info('Renovando token de acceso...');

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

            logger.info('Token renovado exitosamente');
            return this.accessToken;
        } catch (error) {
            logger.error('Error renovando token:', error.response?.data || error.message);
            throw error;
        }
    }

    async getAccessToken() {
        if (!this.accessToken || (this.tokenExpiry && new Date() >= this.tokenExpiry)) {
            await this.authenticate();
        }
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
            logger.info(`Consultando almacén con código: ${code}`);
            const response = await this.client.get(`/warehouses/${code}`, { params });
            return response.data;
        } catch (error) {
            logger.error('Error consultando almacén:', error.response?.data || error.message);
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
            logger.info(`Creando almacén: ${warehouseData.code} - ${warehouseData.name}`);
            const response = await this.client.post('/warehouses', warehouseData);
            logger.info(`Almacén creado exitosamente: ${warehouseData.code}`);
            return response.data;
        } catch (error) {
            logger.error('Error creando almacén:', error.response?.data || error.message);
            throw error;
        }
    }

    async ensureWarehouseExists(warehouseCode) {
        try {
            // Primero verificar si el almacén existe
            const warehouse = await this.getWarehouseByCode(warehouseCode);
            if (warehouse && warehouse.success && warehouse.data) {
                logger.info(`Almacén ${warehouseCode} ya existe`);
                return warehouse.data;
            }
        } catch (error) {
            // Si es 404, el almacén no existe, continuar con la creación
            if (error.response && error.response.status !== 404) {
                throw error;
            }
        }

        // Si llegamos aquí, el almacén no existe, crearlo
        const creationSettings = this.configManager.getWarehouseCreationSettings();
        if (!creationSettings.enabled) {
            throw new Error(`Almacén ${warehouseCode} no encontrado y la creación automática está deshabilitada`);
        }

        const warehouseData = {
            code: warehouseCode,
            name: creationSettings.nameTemplate.replace('{code}', warehouseCode),
            description: creationSettings.descriptionTemplate.replace('{code}', warehouseCode),
            active: true,
            ...creationSettings.defaultValues
        };

        const newWarehouse = await this.createWarehouse(warehouseData);
        
        // Actualizar configuración con el nuevo almacén si es necesario
        const defaultWarehouse = this.configManager.getDefaultWarehouse();
        if (defaultWarehouse.code === warehouseCode) {
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
