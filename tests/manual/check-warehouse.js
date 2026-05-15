/**
 * Inspector de un almacén Fracttal específico.
 *
 * Uso:
 *   node tests/manual/check-warehouse.js [code]
 *   npm run inspect:warehouse -- [code]
 *
 * Ejemplo:
 *   node tests/manual/check-warehouse.js ALM-AMP
 *   node tests/manual/check-warehouse.js TEST001
 *   node tests/manual/check-warehouse.js "COZAMIN 1"
 *
 * Si no se pasa code, usa config.json defaultWarehouse.code.
 *
 * Reporta el flag external_integration que es crítico para que el sync
 * funcione (PUT /inventories_adjustment/ está bloqueado en almacenes
 * con external_integration:true — ver issue #13).
 */

const FracttalClient = require('../../src/services/fracttalClient');
const ConfigManager = require('../../src/config/configManager');
require('dotenv').config();

async function main() {
    const argCode = process.argv[2];
    let code = argCode;

    if (!code) {
        try {
            const cm = new ConfigManager();
            const def = cm.getDefaultWarehouse();
            code = def?.code;
            if (!code) throw new Error('No defaultWarehouse.code en config.json');
            console.log(`(usando defaultWarehouse.code de config.json: ${code})`);
        } catch (e) {
            console.error('❌ No se pasó código y no se pudo leer defaultWarehouse:', e.message);
            console.error('Uso: node tests/manual/check-warehouse.js <code>');
            process.exit(1);
        }
    }

    const client = new FracttalClient();

    try {
        await client.getAccessToken();
    } catch (e) {
        console.error('❌ Error autenticando con Fracttal:', e.message);
        process.exit(1);
    }

    try {
        const resp = await client.getWarehouseByCode(code);
        const data = resp?.data || resp;
        const w = Array.isArray(data) ? data[0] : data;

        if (!w) {
            console.log(`📭 Almacén ${code} no devolvió data utilizable.`);
            console.log('Respuesta cruda:', JSON.stringify(resp).substring(0, 600));
            process.exit(2);
        }

        console.log('═'.repeat(60));
        console.log(`Almacén: ${w.code || code}`);
        console.log('═'.repeat(60));
        console.log(`Descripción              : ${w.description || '(sin descripción)'}`);
        console.log(`ID interno Fracttal      : ${w.id ?? '(no expuesto)'}`);
        console.log(`Activo                   : ${w.active}`);
        console.log(`external_integration     : ${w.external_integration}  ${w.external_integration ? '⚠ ADJUSTMENT BLOQUEADO (ver issue #13)' : '✅ adjustment OK'}`);
        console.log(`visible_to_all           : ${w.visible_to_all}`);
        console.log(`material_request_approval: ${w.material_request_approval ?? '(no expuesto)'}`);
        console.log(`transfer_approval        : ${w.transfer_approval ?? '(no expuesto)'}`);
        if (w.address || w.city || w.state || w.country) {
            console.log(`Ubicación                : ${[w.address, w.city, w.state, w.country].filter(Boolean).join(', ')}`);
        }
        console.log('─'.repeat(60));

        if (w.external_integration === true) {
            console.log('');
            console.log('⚠  ATENCIÓN — almacén integrado:');
            console.log('   - POST /inventories/ funciona (crea items con stock).');
            console.log('   - PUT  /inventories_adjustment/ está BLOQUEADO (HTTP 400).');
            console.log('   - Sync recurrente NO podrá actualizar stock de items existentes.');
            console.log('   - Resolver per issue #13 antes de operar contra este almacén.');
            process.exit(3);
        }

        process.exit(0);
    } catch (error) {
        if (error.response?.status === 404) {
            console.log(`📭 Almacén ${code} NO existe (404).`);
            console.log('   Si SageSync corre con autoCreate:true, el primer sync lo creará');
            console.log('   con los defaults de config.json.warehouseCreationSettings.defaultValues.');
            process.exit(2);
        }
        console.error(`❌ Error consultando almacén ${code}:`, error.response?.data || error.message);
        process.exit(1);
    }
}

main();
