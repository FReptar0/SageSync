const SageService = require('./src/services/sageService');

// Datos de prueba simulando lo que vendría de Sage300
const sampleSageItems = [
    {
        ItemNumber: "201001001",
        Description: "CONECTOR TH",
        Location: "GRAL",
        QuantityOnHand: 15.0000,
        MinimumStock: 0.0000,
        RecentCost: 3.368400
    },
    {
        ItemNumber: "001002001",
        Description: "CORDON DETONANTE E-Cord ( 2 ROLLOS DE 500 MTS C/...)",
        Location: "GRAL",
        QuantityOnHand: 9904.0000,
        MinimumStock: 0.0000,
        RecentCost: 7.978020
    },
    {
        ItemNumber: "001004001",
        Description: "FULMINANTES No. 8 (Capsul)",
        Location: "GRAL",
        QuantityOnHand: 0.0000,
        MinimumStock: 0.0000,
        RecentCost: 3.368433
    },
    {
        ItemNumber: "001006001",
        Description: "NONEL LP 16 FT",
        Location: "GRAL",
        QuantityOnHand: 19406.0000,
        MinimumStock: 0.0000,
        RecentCost: 49.421413
    },
    {
        ItemNumber: "HID001",
        Description: "ACEITE HIDRAULICO MOBIL FLUID 424",
        Location: "ALMACEN",
        QuantityOnHand: 50.0000,
        MinimumStock: 5.0000,
        RecentCost: 85.50
    },
    {
        ItemNumber: "COM001",
        Description: "COMPRESOR SULAIR",
        Location: "TALLER",
        QuantityOnHand: 1.0000,
        MinimumStock: 1.0000,
        RecentCost: 15000.00
    }
];

function testWarehouseMapping() {
    const sage = new SageService();
    
    console.log('🏢 PRUEBA DE MAPEO DE ALMACENES');
    console.log('=' .repeat(60));
    
    // Mostrar configuración actual
    console.log('\n📋 CONFIGURACIÓN ACTUAL:');
    const mappingInfo = sage.getLocationMappingInfo();
    
    console.log('\n🏭 Almacenes disponibles en Fracttal:');
    mappingInfo.availableFracttalWarehouses.forEach((warehouse, index) => {
        console.log(`   ${index + 1}. ${warehouse.code} - ${warehouse.name}`);
        console.log(`      📍 ${warehouse.location}`);
    });
    
    console.log('\n🗺️  Mapeo actual de ubicaciones:');
    Object.entries(mappingInfo.currentMapping).forEach(([sage, fracttal]) => {
        console.log(`   ${sage} → ${fracttal}`);
    });
    
    console.log(`\n🎯 Almacén por defecto: ${mappingInfo.defaultWarehouse}`);
    
    console.log('\n🔍 Reglas especiales para items:');
    Object.entries(mappingInfo.specialItemsRules).forEach(([rule, warehouse]) => {
        console.log(`   ${rule} → ${warehouse}`);
    });
    
    console.log('\n' + '=' .repeat(60));
    console.log('🧪 PRUEBAS CON DATOS DE EJEMPLO:\n');
    
    sampleSageItems.forEach((item, index) => {
        console.log(`${index + 1}. 📦 Item: ${item.ItemNumber}`);
        console.log(`   📝 Descripción: ${item.Description}`);
        console.log(`   📍 Ubicación Sage: ${item.Location}`);
        console.log(`   📊 Stock: ${item.QuantityOnHand} | Min: ${item.MinimumStock} | Costo: $${item.LastCost}`);
        
        // Probar el mapeo
        const mappedWarehouse = sage.mapSageLocationToFracttalWarehouse(
            item.Location,
            item.ItemNumber,
            item.Description
        );
        
        console.log(`   🎯 Almacén Fracttal asignado: ${mappedWarehouse}`);
        
        // Mostrar datos que se enviarían a Fracttal
        const fracttalData = sage.transformToFracttalInventoryFormat(item, mappedWarehouse);
        console.log(`   📤 Datos para Fracttal:`);
        console.log(`      • Stock: ${fracttalData.stock}`);
        console.log(`      • Costo unitario: $${fracttalData.unit_cost_stock}`);
        console.log(`      • Stock mínimo: ${fracttalData.min_stock_level}`);
        console.log(`      • Stock máximo: ${fracttalData.max_stock_level}`);
        console.log(`      • Ubicación física: "${fracttalData.location}"`);
        console.log('');
    });
    
    console.log('=' .repeat(60));
    console.log('✅ PRUEBA DE MAPEO COMPLETADA');
    console.log('\n💡 Notas importantes:');
    console.log('   • Los items con palabras clave especiales se mapean automáticamente');
    console.log('   • Los explosivos van siempre a ALM-AMP por seguridad');
    console.log('   • Las ubicaciones no mapeadas usan el almacén por defecto');
    console.log('   • Puedes modificar el mapeo en sageService.js');
    console.log('\n🔧 Para personalizar:');
    console.log('   1. Edita el objeto locationMapping en sageService.js');
    console.log('   2. Ajusta las reglas especiales en specialItemsMapping');
    console.log('   3. Cambia el almacén por defecto si es necesario');
}

// Ejecutar la prueba
if (require.main === module) {
    testWarehouseMapping();
}

module.exports = testWarehouseMapping;
