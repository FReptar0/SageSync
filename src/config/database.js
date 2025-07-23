const sql = require('mssql');
const logger = require('./logger');
require('dotenv').config();

const config = {
    server: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 1433,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    options: {
        encrypt: process.env.DB_ENCRYPT === 'true',
        trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
        enableArithAbort: true
    },
    pool: {
        max: 10,
        min: 0,
        idleTimeoutMillis: 30000
    },
    connectionTimeout: 60000,
    requestTimeout: 60000
};

class Database {
    constructor() {
        this.pool = null;
        this.connected = false;
    }

    async connect() {
        try {
            if (this.pool) {
                await this.pool.close();
            }
            
            this.pool = await sql.connect(config);
            this.connected = true;
            logger.info('Conexión a base de datos Sage300 establecida exitosamente');
            return this.pool;
        } catch (error) {
            this.connected = false;
            logger.error('Error conectando a la base de datos:', error);
            throw error;
        }
    }

    async disconnect() {
        try {
            if (this.pool) {
                await this.pool.close();
                this.pool = null;
                this.connected = false;
                logger.info('Conexión a base de datos cerrada');
            }
        } catch (error) {
            logger.error('Error cerrando conexión a base de datos:', error);
            throw error;
        }
    }

    async query(queryText, parameters = {}) {
        try {
            if (!this.connected || !this.pool) {
                await this.connect();
            }

            const request = this.pool.request();
            
            // Agregar parámetros si existen
            Object.keys(parameters).forEach(key => {
                request.input(key, parameters[key]);
            });

            const result = await request.query(queryText);
            return result;
        } catch (error) {
            logger.error('Error ejecutando query:', error);
            throw error;
        }
    }

    async testConnection() {
        try {
            const result = await this.query('SELECT 1 as test');
            return result.recordset.length > 0;
        } catch (error) {
            logger.error('Error en test de conexión:', error);
            return false;
        }
    }

    isConnected() {
        return this.connected && this.pool && !this.pool.connected === false;
    }
}

// Crear instancia singleton
const database = new Database();

module.exports = database;
