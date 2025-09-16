const FracttalClient = require('./src/services/fracttalClient');
const SageService = require('./src/services/sageService');
const logger = require('./src/config/logger');

async function testNewSyncLogic() {
    const fracttalClient = new FracttalClient();
    const sage = new SageService();
    
    try {
        console.log('🔄 Iniciando prueba de la nueva lógica de sincronización...\n');
        
        // 1. Validar conexiones
        console.log('1. Validando conexiones...');
        const sageConnected = await sage.validateConnection();
        const fracttalToken = await fracttalClient.getAccessToken();
        console.log(`✅ Sage300: ${sageConnected ? 'Conectado' : 'Desconectado'}`);
        console.log(`✅ Fracttal: ${fracttalToken ? 'Autenticado' : 'No autenticado'}\n`);
        
        if (!sageConnected || !fracttalToken) {
            console.log('❌ No se pueden establecer las conexiones necesarias');
            return;
        }
        
        // 2. Obtener algunos items de prueba desde Sage300
        console.log('2. Obteniendo datos de prueba desde Sage300...');
        const sageItems = await sage.getAllInventoryItems();
        const testItems = sageItems.slice(0, 5); // Solo primeros 5 para prueba
        console.log(`✅ Se obtuvieron ${testItems.length} items para prueba:\n`);
        
        testItems.forEach((item, index) => {
            console.log(`   ${index + 1}. ${item.ItemNumber} - ${item.Description}`);
            console.log(`      Ubicación: ${item.Location} | Stock: ${item.QuantityOnHand} | Costo: ${item.LastCost}`);
        });
        console.log('');
        
        // 3. Probar la nueva lógica de verificación y mapeo
        console.log('3. Probando lógica de verificación y mapeo...\n');
        
        for (const sageItem of testItems) {
            const itemCode = sageItem.ItemNumber?.trim();
            const sageLocation = sageItem.Location?.trim();
            const fracttalWarehouse = sage.mapSageLocationToFracttalWarehouse(sageLocation);
            
            console.log(`📦 Procesando: ${itemCode}`);
            console.log(`   Sage Location: ${sageLocation} → Fracttal Warehouse: ${fracttalWarehouse}`);
            
            // Verificar existencia en Fracttal
            const itemStatus = await fracttalClient.checkItemExistsInWarehouse(itemCode, fracttalWarehouse);
            console.log(`   Estado en Fracttal:`);
            console.log(`     - Existe: ${itemStatus.exists ? 'Sí' : 'No'}`);
            console.log(`     - En almacén ${fracttalWarehouse}: ${itemStatus.inWarehouse ? 'Sí' : 'No'}`);
            
            if (itemStatus.exists && itemStatus.inWarehouse) {
                console.log(`     - Stock actual en Fracttal: ${itemStatus.warehouseData?.stock || 0}`);
                console.log(`     - Costo actual en Fracttal: ${itemStatus.warehouseData?.unit_cost_stock || 0}`);
            }
            
            // Mostrar datos que se enviarían a Fracttal
            const inventoryData = sage.transformToFracttalInventoryFormat(sageItem, fracttalWarehouse);
            console.log(`   Datos a sincronizar:`);
            console.log(`     - Stock: ${inventoryData.stock}`);
            console.log(`     - Costo unitario: ${inventoryData.unit_cost_stock}`);
            console.log(`     - Stock mínimo: ${inventoryData.min_stock_level}`);
            console.log(`     - Stock máximo: ${inventoryData.max_stock_level}`);
            
            // Determinar acción a realizar
            let action = '';
            if (itemStatus.exists && itemStatus.inWarehouse) {
                action = '🔄 ACTUALIZAR - Item existe y está asociado al almacén';
            } else if (itemStatus.exists && !itemStatus.inWarehouse) {
                action = '🔗 ASOCIAR - Item existe pero no está asociado al almacén';
            } else {
                action = '❗ CREAR - Item no existe en Fracttal (requiere creación manual)';
            }
            
            console.log(`   Acción requerida: ${action}\n`);
        }
        
        // 4. Mostrar estadísticas generales
        console.log('4. Estadísticas generales...');
        const stats = await sage.getInventoryStats();
        console.log(`✅ Total items en Sage300: ${stats.TotalItems}`);
        console.log(`✅ Total ubicaciones: ${stats.TotalLocations}`);
        console.log(`✅ Cantidad total: ${Math.round(stats.TotalQuantity)}`);
        console.log(`✅ Costo promedio: $${Math.round(stats.AverageLastCost)}\n`);
        
        // 5. Mostrar mapeo de ubicaciones
        console.log('5. Mapeo de ubicaciones Sage → Fracttal:');
        const locations = await sage.getUniqueLocations();
        locations.forEach(location => {
            const mappedWarehouse = sage.mapSageLocationToFracttalWarehouse(location);
            console.log(`   ${location} → ${mappedWarehouse}`);
        });
        
        console.log('\n🎉 Prueba de lógica completada exitosamente!');
        console.log('\n📝 Notas importantes:');
        console.log('   - Los items que no existen en Fracttal deben crearse manualmente primero');
        console.log('   - Verificar que el mapeo de ubicaciones sea correcto');
        console.log('   - Los costos se toman del LastCost de Sage300');
        console.log('   - Stock máximo se calcula como MinimumStock × 3');
        
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
    testNewSyncLogic();
}

module.exports = testNewSyncLogic;
