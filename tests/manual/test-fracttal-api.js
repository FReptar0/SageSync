const FracttalClient = require('./src/services/fracttalClient');
const logger = require('./src/config/logger');

async function testFracttalAPI() {
    const fracttalClient = new FracttalClient();
    
    try {
        console.log('🔐 Iniciando prueba de la API de Fracttal...\n');
        
        // 1. Autenticación
        console.log('1. Autenticando con Fracttal...');
        const token = await fracttalClient.authenticate();
        console.log(`✅ Autenticación exitosa. Token obtenido: ${token.substring(0, 20)}...\n`);
        
        // 2. Consultar todos los almacenes
        console.log('2. Consultando todos los almacenes...');
        const warehouses = await fracttalClient.getAllWarehouses();
        console.log(`✅ Almacenes encontrados: ${warehouses.total || warehouses.data?.length || 0}`);
        
        if (warehouses.data && warehouses.data.length > 0) {
            console.log('📦 Primeros almacenes:');
            warehouses.data.slice(0, 3).forEach((warehouse, index) => {
                console.log(`   ${index + 1}. Código: ${warehouse.code} - Descripción: ${warehouse.description}`);
            });
        }
        console.log('');
        
        // 3. Consultar un almacén específico (si existe)
        if (warehouses.data && warehouses.data.length > 0) {
            const firstWarehouse = warehouses.data[0];
            console.log(`3. Consultando almacén específico: ${firstWarehouse.code}...`);
            const warehouseDetail = await fracttalClient.getWarehouseByCode(firstWarehouse.code);
            console.log('✅ Detalle del almacén:');
            
            // La respuesta viene como un array
            const warehouse = Array.isArray(warehouseDetail.data) ? warehouseDetail.data[0] : warehouseDetail.data;
            
            if (warehouse) {
                console.log(`   - ID: ${warehouse.id || 'N/A'}`);
                console.log(`   - Código: ${warehouse.code || 'N/A'}`);
                console.log(`   - Descripción: ${warehouse.description || 'N/A'}`);
                console.log(`   - Dirección: ${warehouse.address || 'N/A'}`);
                console.log(`   - Estado: ${warehouse.state || 'N/A'}`);
                console.log(`   - País: ${warehouse.country || 'N/A'}`);
                console.log(`   - Ciudad: ${warehouse.city || 'N/A'}`);
                console.log(`   - Activo: ${warehouse.active !== undefined ? (warehouse.active ? 'Sí' : 'No') : 'N/A'}`);
                console.log(`   - Integración externa: ${warehouse.external_integration !== undefined ? (warehouse.external_integration ? 'Sí' : 'No') : 'N/A'}`);
                console.log(`   - Visible para todos: ${warehouse.visible_to_all !== undefined ? (warehouse.visible_to_all ? 'Sí' : 'No') : 'N/A'}`);
                console.log(`   - Costo total stock: ${warehouse.total_cost_stock || 0}`);
            }
            console.log('');
        }
        
        // 4. Consultar algunos inventarios
        console.log('4. Consultando inventarios...');
        const inventories = await fracttalClient.getAllInventories({ limit: 5 });
        console.log(`✅ Inventarios encontrados: ${inventories.total || inventories.data?.length || 0}`);
        
        if (inventories.data && inventories.data.length > 0) {
            console.log('📋 Primeros inventarios:');
            inventories.data.forEach((item, index) => {
                console.log(`   ${index + 1}. Código: ${item.code} - Descripción: ${item.description}`);
                if (item.warehouses && item.warehouses.length > 0) {
                    console.log(`      Stock en ${item.warehouses[0].code_warehouse}: ${item.warehouses[0].stock} unidades`);
                }
            });
            console.log('');
            
            // 5. Consultar un inventario específico
            const firstItem = inventories.data[0];
            console.log(`5. Consultando inventario específico: ${firstItem.code}...`);
            const itemDetail = await fracttalClient.getInventoryByCode(firstItem.code);
            console.log('✅ Detalle del inventario:');
            
            // La respuesta puede venir como array o objeto
            const itemData = Array.isArray(itemDetail.data) ? itemDetail.data[0] : itemDetail.data;
            
            if (itemData) {
                console.log(`   - ID: ${itemData.id || 'N/A'}`);
                console.log(`   - Código: ${itemData.code || 'N/A'}`);
                console.log(`   - Descripción: ${itemData.description || 'N/A'}`);
                console.log(`   - Campo 1: ${itemData.field_1 || 'N/A'}`);
                console.log(`   - Campo 2: ${itemData.field_2 || 'N/A'}`);
                console.log(`   - Compañía ID: ${itemData.id_company || 'N/A'}`);
                
                if (itemData.warehouses && Array.isArray(itemData.warehouses) && itemData.warehouses.length > 0) {
                    console.log('   - Almacenes asociados:');
                    itemData.warehouses.forEach((wh, index) => {
                        console.log(`     Almacén ${index + 1}:`);
                        console.log(`       • Código: ${wh.code_warehouse || 'N/A'}`);
                        console.log(`       • Stock actual: ${wh.stock || 0}`);
                        console.log(`       • Stock mínimo: ${wh.min_stock_level || 0}`);
                        console.log(`       • Stock máximo: ${wh.max_stock_level || 0}`);
                        console.log(`       • Costo unitario: ${wh.unit_cost_stock || 0}`);
                        console.log(`       • Ubicación: ${wh.location || 'N/A'}`);
                    });
                } else {
                    console.log('   - No tiene almacenes asociados o datos de stock');
                }
            }
        }
        
        console.log('\n🎉 Prueba completada exitosamente!');
        
    } catch (error) {
        console.error('❌ Error en la prueba:', error.message);
        if (error.response) {
            console.error('   Status:', error.response.status);
            console.error('   Data:', JSON.stringify(error.response.data, null, 2));
        }
    }
}

// Ejecutar la prueba
if (require.main === module) {
    testFracttalAPI();
}

module.exports = testFracttalAPI;
