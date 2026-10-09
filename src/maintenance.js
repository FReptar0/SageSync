#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const logger = require('./config/logger');
const ConfigManager = require('./config/configManager');

class MaintenanceScript {
    constructor() {
        this.configManager = new ConfigManager();
        this.rootDir = path.dirname(__dirname); // Subir un nivel desde src/
        this.logsDir = path.join(this.rootDir, 'logs');
        this.tokenFile = path.join(this.rootDir, '.fracttal-token');
    }

    async run() {
        try {
            console.log('🔧 Iniciando tareas de mantenimiento...\n');

            await this.cleanLogs();
            await this.validateConfiguration();
            await this.checkTokenStatus();
            await this.displaySystemInfo();

            console.log('\n✅ Tareas de mantenimiento completadas exitosamente');
        } catch (error) {
            console.error('❌ Error durante el mantenimiento:', error.message);
            process.exit(1);
        }
    }

    async cleanLogs() {
        try {
            console.log('📝 Limpiando archivos de log...');

            if (!fs.existsSync(this.logsDir)) {
                console.log('   - Directorio de logs no existe, creándolo...');
                fs.mkdirSync(this.logsDir, { recursive: true });
                return;
            }

            const logFiles = fs.readdirSync(this.logsDir);
            const now = new Date();
            const daysToKeep = 30; // Mantener logs de los últimos 30 días
            
            let cleanedFiles = 0;
            let totalSize = 0;

            for (const file of logFiles) {
                const filePath = path.join(this.logsDir, file);
                const stats = fs.statSync(filePath);
                const fileAge = (now - stats.mtime) / (1000 * 60 * 60 * 24); // días

                if (fileAge > daysToKeep) {
                    fs.unlinkSync(filePath);
                    cleanedFiles++;
                    console.log(`   - Eliminado: ${file} (${fileAge.toFixed(1)} días)`);
                } else {
                    totalSize += stats.size;
                }
            }

            console.log(`   - Archivos eliminados: ${cleanedFiles}`);
            console.log(`   - Tamaño total de logs: ${(totalSize / 1024 / 1024).toFixed(2)} MB`);
        } catch (error) {
            console.error('   ❌ Error limpiando logs:', error.message);
        }
    }

    async validateConfiguration() {
        try {
            console.log('\n⚙️  Validando configuración...');
            
            this.configManager.validateConfig();
            console.log('   ✅ Configuración válida');

            const locationMappings = this.configManager.getAllLocationMappings();
            console.log(`   - Ubicaciones configuradas: ${Object.keys(locationMappings).join(', ')}`);

            const defaultWarehouse = this.configManager.getDefaultWarehouse();
            console.log(`   - Almacén por defecto: ${defaultWarehouse.code} (${defaultWarehouse.name})`);

            const warehouseSettings = this.configManager.getWarehouseCreationSettings();
            console.log(`   - Auto-creación de almacenes: ${warehouseSettings.enabled ? 'Habilitada' : 'Deshabilitada'}`);

        } catch (error) {
            console.error('   ❌ Error en configuración:', error.message);
            throw error;
        }
    }

    async checkTokenStatus() {
        try {
            console.log('\n🔐 Verificando estado del token...');

            const token = this.configManager.loadToken();
            if (!token) {
                console.log('   - No hay token guardado');
                return;
            }

            const expiresAt = new Date(token.expires_at);
            const now = new Date();
            const hoursUntilExpiry = (expiresAt - now) / (1000 * 60 * 60);

            console.log(`   - Token encontrado: ${token.token_type}`);
            console.log(`   - Creado: ${new Date(token.created_at).toLocaleString()}`);
            console.log(`   - Expira: ${expiresAt.toLocaleString()}`);

            if (hoursUntilExpiry <= 0) {
                console.log('   ⚠️  Token expirado');
            } else if (hoursUntilExpiry < 24) {
                console.log(`   ⚠️  Token expira en ${hoursUntilExpiry.toFixed(1)} horas`);
            } else {
                console.log(`   ✅ Token válido por ${(hoursUntilExpiry / 24).toFixed(1)} días más`);
            }

        } catch (error) {
            console.error('   ❌ Error verificando token:', error.message);
        }
    }

    async displaySystemInfo() {
        try {
            console.log('\n📊 Información del sistema...');

            // Información de Node.js
            console.log(`   - Node.js: ${process.version}`);
            console.log(`   - Plataforma: ${process.platform} ${process.arch}`);

            // Información de memoria
            const memUsage = process.memoryUsage();
            console.log(`   - Memoria RSS: ${(memUsage.rss / 1024 / 1024).toFixed(2)} MB`);
            console.log(`   - Heap usado: ${(memUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`);

            // Verificar archivos críticos
            const criticalFiles = [
                'package.json',
                // Archivo de configuración activo: CONFIG_PATH o config.json
                this.configManager.configPath,
                '.env',
                'src/app.js',
                'src/services/fracttalClient.js',
                'src/services/sageService.js'
            ];

            console.log('   - Archivos críticos:');
            for (const file of criticalFiles) {
                const exists = fs.existsSync(path.resolve(this.rootDir, file));
                console.log(`     ${exists ? '✅' : '❌'} ${file}`);
            }

        } catch (error) {
            console.error('   ❌ Error obteniendo información del sistema:', error.message);
        }
    }

    // Método para forzar renovación de token
    async renewToken() {
        try {
            console.log('🔄 Renovando token...');
            
            this.configManager.clearToken();
            const FracttalClient = require('./services/fracttalClient');
            const fracttal = new FracttalClient();
            
            await fracttal.authenticate();
            console.log('   ✅ Token renovado exitosamente');
            
        } catch (error) {
            console.error('   ❌ Error renovando token:', error.message);
            throw error;
        }
    }

    // Método para backup de configuración
    async backupConfig() {
        try {
            console.log('💾 Creando backup de configuración...');
            
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupName = `config-backup-${timestamp}.json`;
            const backupPath = path.join(this.rootDir, 'backups', backupName);
            
            // Crear directorio de backups si no existe
            const backupDir = path.dirname(backupPath);
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            
            // Copiar el archivo de configuración activo (CONFIG_PATH o config.json)
            const configPath = this.configManager.configPath;
            fs.copyFileSync(configPath, backupPath);
            
            console.log(`   - Archivo origen: ${configPath}`);
            console.log(`   ✅ Backup creado: ${backupName}`);
            
        } catch (error) {
            console.error('   ❌ Error creando backup:', error.message);
            throw error;
        }
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    const maintenance = new MaintenanceScript();
    
    const command = process.argv[2];
    
    switch (command) {
        case 'renew-token':
            maintenance.renewToken();
            break;
        case 'backup-config':
            maintenance.backupConfig();
            break;
        case 'clean-logs':
            maintenance.cleanLogs();
            break;
        default:
            maintenance.run();
    }
}

module.exports = MaintenanceScript;
