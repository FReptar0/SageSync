/**
 * Lista todos los almacenes del tenant Fracttal con su flag external_integration.
 *
 * Uso:
 *   node tests/manual/list-warehouses.js
 *   npm run inspect:warehouses
 *
 * Útil como auditoría pre-deploy: identificar qué almacenes son integrados
 * (donde PUT /inventories_adjustment/ está bloqueado, ver issue #13) antes
 * de apuntar el sync hacia ellos.
 *
 * Output: tabla compacta + resumen de cuántos integrados vs no-integrados.
 * Exit code 3 si hay al menos un almacén integrado en el tenant (warning).
 */

const FracttalClient = require('../../src/services/fracttalClient');
require('dotenv').config();

const PAGE_LIMIT = 100;

async function fetchAll(client) {
    let all = [];
    let page = 1;
    let total = null;

    while (true) {
        const resp = await client.getAllWarehouses({ limit: PAGE_LIMIT, page });
        const data = resp?.data || [];
        if (!Array.isArray(data)) break;
        all = all.concat(data);
        if (total === null && typeof resp?.total === 'number') total = resp.total;
        if (data.length < PAGE_LIMIT) break;
        page += 1;
        if (page > 50) break;  // safety cap
    }

    return { warehouses: all, total };
}

async function main() {
    const client = new FracttalClient();

    try {
        await client.getAccessToken();
    } catch (e) {
        console.error('❌ Error autenticando con Fracttal:', e.message);
        process.exit(1);
    }

    let warehouses;
    try {
        const result = await fetchAll(client);
        warehouses = result.warehouses;
    } catch (e) {
        console.error('❌ Error listando almacenes:', e.response?.data || e.message);
        process.exit(1);
    }

    if (warehouses.length === 0) {
        console.log('📭 No se encontraron almacenes en este tenant.');
        process.exit(0);
    }

    console.log('═'.repeat(90));
    console.log(`Almacenes en el tenant: ${warehouses.length}`);
    console.log('═'.repeat(90));
    console.log('CODE                          INTEGRADO  ACTIVO  VISIBLE  DESCRIPCIÓN');
    console.log('─'.repeat(90));

    let integratedCount = 0;
    for (const w of warehouses) {
        const code = String(w.code || '').padEnd(28).substring(0, 28);
        const integrated = w.external_integration === true;
        if (integrated) integratedCount++;
        const integratedStr = integrated ? '⚠ TRUE   ' : '  false  ';
        const active = (w.active === true ? '  yes ' : '  no  ');
        const visible = (w.visible_to_all === true ? '  yes  ' : '  no   ');
        const desc = String(w.description || '').substring(0, 30);
        console.log(`${code}  ${integratedStr}  ${active}  ${visible}  ${desc}`);
    }

    console.log('─'.repeat(90));
    console.log(`Total: ${warehouses.length}  |  Integrados (sync recurrente bloqueado): ${integratedCount}  |  No-integrados: ${warehouses.length - integratedCount}`);

    if (integratedCount > 0) {
        console.log('');
        console.log('⚠  Almacenes integrados detectados — el sync de SageSync NO puede actualizar');
        console.log('   stock de items existentes en ellos (PUT /inventories_adjustment/ devuelve');
        console.log('   HTTP 400). Ver issue #13 + backlog 999.3 antes de apuntar sync hacia ellos.');
        process.exit(3);
    }

    process.exit(0);
}

main();
