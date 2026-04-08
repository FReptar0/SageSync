#!/usr/bin/env node

/**
 * SageSync — Auto-Setup
 *
 * Conecta a Sage300, descubre ubicaciones, crea almacenes en Fracttal,
 * y genera config.json automáticamente.
 *
 * Requisitos:
 *   - .env configurado con credenciales de Sage300 y Fracttal
 *   - Acceso de red a SQL Server y Fracttal API
 *
 * Uso:
 *   node scripts/setup-automap.js                    → modo interactivo
 *   node scripts/setup-automap.js --dry-run          → solo muestra qué haría, no crea nada
 *   node scripts/setup-automap.js --prefix ALM       → prefijo para códigos de almacén (default: ALM)
 *   node scripts/setup-automap.js --state Zacatecas --city Morelos --country México
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const sql = require('mssql');
const readline = require('readline');

// ─── Parsear argumentos ────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');
const PREFIX = args.includes('--prefix') ? args[args.indexOf('--prefix') + 1] : 'ALM';
const STATE = args.includes('--state') ? args[args.indexOf('--state') + 1] : '';
const CITY = args.includes('--city') ? args[args.indexOf('--city') + 1] : '';
const COUNTRY = args.includes('--country') ? args[args.indexOf('--country') + 1] : 'México';

const CONFIG_PATH = path.join(__dirname, '..', 'config.json');

// ─── Utilidades ────────────────────────────────────────────────────
function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

function buildWarehouseCode(location) {
    const clean = location.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    return `${PREFIX}-${clean}`;
}

function buildWarehouseName(location) {
    return `ALMACEN ${location.toUpperCase()}`;
}

// ─── Conexión a Sage300 ────────────────────────────────────────────
async function connectSage() {
    const config = {
        server: process.env.DB_HOST,
        port: parseInt(process.env.DB_PORT) || 1433,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        options: {
            encrypt: process.env.DB_ENCRYPT === 'true',
            trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true',
            enableArithAbort: true,
        },
        connectionTimeout: 30000,
        requestTimeout: 30000,
    };

    console.log(`\n🔌 Conectando a Sage300: ${config.server}:${config.port}/${config.database}...`);
    const pool = await sql.connect(config);
    console.log('✅ Conexión a Sage300 exitosa\n');
    return pool;
}

// ─── Descubrir ubicaciones ─────────────────────────────────────────
async function discoverLocations(pool) {
    console.log('🔍 Descubriendo ubicaciones en Sage300...\n');

    const result = await pool.request().query(`
        SELECT
            B.LOCATION,
            COUNT(DISTINCT B.ITEMNO) AS ItemCount,
            SUM(ISNULL(B.QTYONHAND - B.QTYCOMMIT - B.QTYSHNOCST + B.QTYRENOCST + B.QTYADNOCST, 0)) AS TotalStock
        FROM ICILOC AS B
        JOIN ICITEM AS I ON B.ITEMNO = I.ITEMNO
        WHERE I.INACTIVE = 0 AND I.STOCKITEM = 1
        GROUP BY B.LOCATION
        ORDER BY B.LOCATION
    `);

    const locations = result.recordset;

    console.log('╔════════════════════╦══════════╦══════════════╗');
    console.log('║ Ubicación          ║  Items   ║ Stock Total  ║');
    console.log('╠════════════════════╬══════════╬══════════════╣');
    for (const loc of locations) {
        const name = loc.LOCATION.padEnd(18);
        const items = String(loc.ItemCount).padStart(6);
        const stock = String(Math.round(loc.TotalStock)).padStart(10);
        console.log(`║ ${name} ║ ${items}   ║ ${stock}     ║`);
    }
    console.log('╚════════════════════╩══════════╩══════════════╝');

    const totalItems = locations.reduce((sum, l) => sum + l.ItemCount, 0);
    const totalStock = locations.reduce((sum, l) => sum + l.TotalStock, 0);
    console.log(`\n📊 Total: ${locations.length} ubicaciones, ${totalItems} items, ${Math.round(totalStock)} unidades de stock\n`);

    return locations;
}

// ─── Conectar a Fracttal ───────────────────────────────────────────
async function getFracttalToken() {
    const axios = require('axios');

    console.log('🔐 Autenticando con Fracttal...');
    const response = await axios.post(process.env.FRACTTAL_OAUTH_URL, {
        grant_type: 'client_credentials',
        client_id: process.env.FRACTTAL_CLIENT_ID,
        client_secret: process.env.FRACTTAL_CLIENT_SECRET,
    });

    console.log('✅ Autenticación con Fracttal exitosa\n');
    return response.data.access_token;
}

async function createFracttalWarehouse(token, warehouseData) {
    const axios = require('axios');

    const payload = {
        code: warehouseData.code,
        description: warehouseData.description,
        address: warehouseData.address || '',
        state: warehouseData.state || '',
        city: warehouseData.city || '',
        country: warehouseData.country || '',
        active: true,
        external_integration: true,
        visible_to_all: true,
    };

    const response = await axios.post(
        `${process.env.FRACTTAL_BASE_URL}/warehouses/`,
        payload,
        { headers: { Authorization: `Bearer ${token}` } }
    );

    return response.data;
}

async function checkFracttalWarehouse(token, code) {
    const axios = require('axios');

    try {
        const response = await axios.get(
            `${process.env.FRACTTAL_BASE_URL}/warehouses/${code}`,
            { headers: { Authorization: `Bearer ${token}` } }
        );
        return response.data && response.data.success ? response.data.data : null;
    } catch (error) {
        if (error.response && error.response.status === 404) return null;
        throw error;
    }
}

// ─── Generar config.json ───────────────────────────────────────────
function generateConfig(locations, mappings) {
    const locationMapping = {};
    for (const mapping of mappings) {
        locationMapping[mapping.sageLocation] = {
            fracttalWarehouseCode: mapping.warehouseCode,
            fracttalWarehouseName: mapping.warehouseName,
            description: `Almacén para ubicación ${mapping.sageLocation}`,
            autoCreate: true,
            warehouseConfig: {
                description: `${mapping.warehouseName} - Sincronizado desde Sage300`,
                address: mapping.address || '',
                state: mapping.state || STATE,
                country: mapping.country || COUNTRY,
                city: mapping.city || CITY,
                active: true,
                external_integration: true,
                visible_to_all: true,
                material_request_approval: false,
            },
        };
    }

    // El primer mapeo como default
    const firstMapping = mappings[0];

    return {
        locationMapping,
        defaultWarehouse: {
            code: firstMapping.warehouseCode,
            name: firstMapping.warehouseName,
            autoCreate: true,
        },
        syncSettings: {
            batchSize: 100,
            maxRetries: 3,
            retryDelay: 5000,
            logLevel: 'info',
        },
        warehouseCreationSettings: {
            enabled: true,
            nameTemplate: 'ALMACEN {code}',
            descriptionTemplate: 'Almacén auto-creado para ubicación {code}',
            prefix: `${PREFIX}-`,
            defaultValues: {
                active: true,
                external_integration: true,
                visible_to_all: true,
                material_request_approval: false,
                allow_negative_stock: false,
                state: STATE,
                country: COUNTRY,
            },
        },
    };
}

// ─── Main ──────────────────────────────────────────────────────────
async function main() {
    console.log('╔══════════════════════════════════════════════╗');
    console.log('║       SageSync — Auto-Setup                  ║');
    console.log('╚══════════════════════════════════════════════╝');

    if (DRY_RUN) {
        console.log('⚠️  MODO DRY-RUN: solo muestra qué haría, no crea nada\n');
    }

    // Verificar env vars mínimas
    const required = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD', 'FRACTTAL_BASE_URL', 'FRACTTAL_OAUTH_URL', 'FRACTTAL_CLIENT_ID', 'FRACTTAL_CLIENT_SECRET'];
    const missing = required.filter((v) => !process.env[v]);
    if (missing.length > 0) {
        console.error(`❌ Variables de entorno faltantes: ${missing.join(', ')}`);
        console.error('   Crea el archivo .env primero.');
        process.exit(1);
    }

    // Verificar si config.json ya existe
    if (fs.existsSync(CONFIG_PATH)) {
        const answer = await ask('⚠️  config.json ya existe. ¿Sobrescribir? (s/N): ');
        if (answer.toLowerCase() !== 's') {
            console.log('Cancelado.');
            process.exit(0);
        }
    }

    // 1. Conectar a Sage300 y descubrir ubicaciones
    let pool;
    try {
        pool = await connectSage();
    } catch (error) {
        console.error(`❌ No se pudo conectar a Sage300: ${error.message}`);
        console.error('   Verifica DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD en .env');
        process.exit(1);
    }

    let locations;
    try {
        locations = await discoverLocations(pool);
    } finally {
        await pool.close();
    }

    if (locations.length === 0) {
        console.error('❌ No se encontraron ubicaciones con inventario activo en Sage300.');
        process.exit(1);
    }

    // 2. Generar mapeos propuestos
    console.log('📋 Mapeos propuestos:\n');
    const mappings = locations.map((loc) => ({
        sageLocation: loc.LOCATION.trim(),
        warehouseCode: buildWarehouseCode(loc.LOCATION.trim()),
        warehouseName: buildWarehouseName(loc.LOCATION.trim()),
        itemCount: loc.ItemCount,
        state: STATE,
        city: CITY,
        country: COUNTRY,
        address: '',
    }));

    for (const m of mappings) {
        console.log(`  ${m.sageLocation} → ${m.warehouseCode} (${m.warehouseName}) — ${m.itemCount} items`);
    }

    console.log('');
    const confirm = await ask('¿Proceder con estos mapeos? (S/n): ');
    if (confirm.toLowerCase() === 'n') {
        console.log('Cancelado. Puedes editar el script o crear config.json manualmente.');
        process.exit(0);
    }

    // 3. Conectar a Fracttal y crear almacenes
    let token;
    try {
        token = await getFracttalToken();
    } catch (error) {
        console.error(`❌ No se pudo autenticar con Fracttal: ${error.message}`);
        console.error('   Verifica FRACTTAL_CLIENT_ID y FRACTTAL_CLIENT_SECRET en .env');
        process.exit(1);
    }

    console.log('🏗️  Creando almacenes en Fracttal...\n');
    let created = 0;
    let existing = 0;
    let errors = 0;

    for (const m of mappings) {
        try {
            // Verificar si ya existe
            const existingWarehouse = await checkFracttalWarehouse(token, m.warehouseCode);
            if (existingWarehouse) {
                console.log(`  ✅ ${m.warehouseCode} — ya existe`);
                existing++;
                continue;
            }

            if (DRY_RUN) {
                console.log(`  🔵 ${m.warehouseCode} — se crearía (dry-run)`);
                created++;
                continue;
            }

            await createFracttalWarehouse(token, {
                code: m.warehouseCode,
                description: m.warehouseName,
                state: m.state,
                city: m.city,
                country: m.country,
            });
            console.log(`  ✅ ${m.warehouseCode} — creado`);
            created++;
        } catch (error) {
            console.error(`  ❌ ${m.warehouseCode} — error: ${error.response?.data?.message || error.message}`);
            errors++;
        }
    }

    console.log(`\n📊 Resultado: ${created} creados, ${existing} ya existían, ${errors} errores\n`);

    // 4. Generar config.json
    const config = generateConfig(locations, mappings);

    if (DRY_RUN) {
        console.log('📄 config.json que se generaría:\n');
        console.log(JSON.stringify(config, null, 2));
        console.log('\n⚠️  Dry-run: no se escribió nada.');
    } else {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        console.log(`✅ config.json generado: ${CONFIG_PATH}`);
    }

    console.log('\n🎉 ¡Setup completado!');
    console.log('\nSiguientes pasos:');
    console.log('  1. Revisa config.json y ajusta direcciones si es necesario');
    console.log('  2. Ejecuta la carga inicial: node src/sync.js');
    console.log('  3. Verifica en Fracttal que los items se crearon correctamente');
}

main().catch((err) => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
});
