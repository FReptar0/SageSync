const FracttalClient = require('../../src/services/fracttalClient');
require('dotenv').config();

async function testFracttalAuth() {
    console.log('🔧 Iniciando test de autenticación con Fracttal...\n');
    
    try {
        const client = new FracttalClient();
        
        console.log('1️⃣ Probando autenticación inicial...');
        const token = await client.authenticate();
        console.log(`✅ Token obtenido: ${token.substring(0, 50)}...`);
        console.log('');
        
        console.log('2️⃣ Probando consulta de almacenes...');
        const warehouses = await client.getAllWarehouses();
        console.log(`📦 Almacenes encontrados: ${warehouses.data ? warehouses.data.length : 0}`);
        if (warehouses.data && warehouses.data.length > 0) {
            warehouses.data.forEach(wh => {
                console.log(`   - ${wh.code}: ${wh.description}`);
            });
        } else {
            console.log('   ℹ️  No hay almacenes en la cuenta');
        }
        console.log('');
        
        console.log('3️⃣ Probando consulta de almacén específico ALM-AMP...');
        try {
            const warehouse = await client.getWarehouseByCode('ALM-AMP');
            console.log(`✅ Almacén ALM-AMP encontrado: ${warehouse.data.description}`);
        } catch (error) {
            if (error.response && error.response.status === 404) {
                console.log('📭 Almacén ALM-AMP no existe, será creado automáticamente cuando sea necesario');
            } else {
                throw error;
            }
        }
        console.log('');
        
        console.log('4️⃣ Probando consulta de inventarios...');
        const inventories = await client.getAllInventories();
        console.log(`📋 Inventarios encontrados: ${inventories.data ? inventories.data.length : 0}`);
        if (inventories.data && inventories.data.length > 0) {
            inventories.data.slice(0, 5).forEach(inv => {
                console.log(`   - ${inv.code}: ${inv.description || 'Sin descripción'}`);
            });
            if (inventories.data.length > 5) {
                console.log(`   ... y ${inventories.data.length - 5} más`);
            }
        } else {
            console.log('   ℹ️  No hay inventarios en la cuenta');
        }
        
        console.log('\n✅ Test de autenticación completado exitosamente');
        
    } catch (error) {
        console.error('\n❌ Error en test de autenticación:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
        process.exit(1);
    }
}

testFracttalAuth();
