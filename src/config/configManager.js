const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class ConfigManager {
    constructor() {
        this.configPath = path.join(__dirname, '../../config.json');
        this.tokenPath = path.join(__dirname, '../../.fracttal-token');
        this.config = null;
        this.loadConfig();
    }

    loadConfig() {
        try {
            if (fs.existsSync(this.configPath)) {
                const configData = fs.readFileSync(this.configPath, 'utf8');
                this.config = JSON.parse(configData);
                logger.info('Configuración cargada exitosamente desde config.json');
            } else {
                logger.error('Archivo config.json no encontrado');
                throw new Error('Archivo config.json no encontrado');
            }
        } catch (error) {
            logger.error('Error cargando configuración:', error);
            throw error;
        }
    }

    getLocationMapping(sageLocation) {
        return this.config.locationMapping[sageLocation] || null;
    }

    getAllLocationMappings() {
        return this.config.locationMapping;
    }

    getDefaultWarehouse() {
        return this.config.defaultWarehouse;
    }

    getSyncSettings() {
        return this.config.syncSettings;
    }

    getWarehouseCreationSettings() {
        return this.config.warehouseCreationSettings;
    }

    // Manejo de token
    saveToken(tokenData) {
        try {
            const tokenInfo = {
                access_token: tokenData.access_token,
                refresh_token: tokenData.refresh_token,
                expires_in: tokenData.expires_in,
                token_type: tokenData.token_type,
                created_at: new Date().toISOString(),
                expires_at: new Date(Date.now() + (tokenData.expires_in * 1000)).toISOString()
            };

            fs.writeFileSync(this.tokenPath, JSON.stringify(tokenInfo, null, 2));
            logger.info('Token guardado exitosamente');
            return true;
        } catch (error) {
            logger.error('Error guardando token:', error);
            return false;
        }
    }

    loadToken() {
        try {
            if (fs.existsSync(this.tokenPath)) {
                const tokenData = fs.readFileSync(this.tokenPath, 'utf8');
                const tokenInfo = JSON.parse(tokenData);
                
                // Verificar si el token ha expirado
                const now = new Date();
                const expiresAt = new Date(tokenInfo.expires_at);
                
                if (now >= expiresAt) {
                    logger.info('Token expirado, se requiere renovación');
                    return null;
                }
                
                logger.info('Token cargado desde archivo');
                return tokenInfo;
            }
            return null;
        } catch (error) {
            logger.error('Error cargando token:', error);
            return null;
        }
    }

    clearToken() {
        try {
            if (fs.existsSync(this.tokenPath)) {
                fs.unlinkSync(this.tokenPath);
                logger.info('Token eliminado');
            }
        } catch (error) {
            logger.error('Error eliminando token:', error);
        }
    }

    // Actualizar configuración dinámicamente
    updateLocationMapping(sageLocation, fracttalWarehouseCode, config = {}) {
        if (!this.config.locationMapping) {
            this.config.locationMapping = {};
        }

        this.config.locationMapping[sageLocation] = {
            fracttalWarehouseCode: fracttalWarehouseCode,
            ...config
        };

        this.saveConfig();
        logger.info(`Mapeo actualizado: ${sageLocation} -> ${fracttalWarehouseCode}`);
    }

    saveConfig() {
        try {
            fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
            logger.info('Configuración guardada exitosamente');
        } catch (error) {
            logger.error('Error guardando configuración:', error);
            throw error;
        }
    }

    // Validaciones
    validateConfig() {
        const errors = [];

        if (!this.config.locationMapping || Object.keys(this.config.locationMapping).length === 0) {
            errors.push('No hay mapeos de ubicación configurados');
        }

        if (!this.config.defaultWarehouse || !this.config.defaultWarehouse.code) {
            errors.push('No hay almacén por defecto configurado');
        }

        if (errors.length > 0) {
            logger.error('Errores de configuración:', errors);
            throw new Error(`Configuración inválida: ${errors.join(', ')}`);
        }

        return true;
    }
}

module.exports = ConfigManager;
