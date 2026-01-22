const FracttalClient = require('../../src/services/fracttalClient');
require('dotenv').config();

/**
 * Test manual con logs detallados para validar endpoints de Fracttal
 * Muestra la respuesta completa de cada endpoint para validación
 */

async function testWithDetailedLogs() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🧪 TEST DE API FRACTTAL CON LOGS DETALLADOS');
    console.log('═══════════════════════════════════════════════════════════════\n');

    const client = new FracttalClient();
    const results = {
        authentication: null,
        warehouses: null,
        items: null,
        specificItem: null
    };

    try {
        // ===================================================================
        // ETAPA 1: AUTENTICACIÓN
        // ===================================================================
        console.log('┌─────────────────────────────────────────────────────────────┐');
        console.log('│ ETAPA 1: AUTENTICACIÓN                                       │');
        console.log('└─────────────────────────────────────────────────────────────┘');
        console.log('🔐 Endpoint: POST /oauth/token');
        console.log('📍 URL:', client.oauthURL);
        console.log('');

        const token = await client.authenticate();
        
        results.authentication = {
            success: !!token,
            token: token ? `${token.substring(0, 30)}...` : null,
            tokenLength: token ? token.length : 0,
            expiry: client.tokenExpiry ? client.tokenExpiry.toISOString() : null,
            hasRefreshToken: !!client.refreshToken
        };

        console.log('✅ RESULTADO:');
        console.log('   • Token obtenido:', results.authentication.success ? 'SÍ' : 'NO');
        console.log('   • Longitud del token:', results.authentication.tokenLength, 'caracteres');
        console.log('   • Expira:', results.authentication.expiry);
        console.log('   • Tiene refresh token:', results.authentication.hasRefreshToken ? 'SÍ' : 'NO');
        console.log('');

        // ===================================================================
        // ETAPA 2: CONSULTAR ALMACENES
        // ===================================================================
        console.log('┌─────────────────────────────────────────────────────────────┐');
        console.log('│ ETAPA 2: CONSULTAR ALMACENES                                 │');
        console.log('└─────────────────────────────────────────────────────────────┘');
        console.log('📡 Endpoint: GET /warehouses');
        console.log('📍 URL:', `${client.baseURL}/warehouses`);
        console.log('');

        try {
            const warehouses = await client.getAllWarehouses({ limit: 5 });
            
            results.warehouses = {
                success: true,
                statusResponse: warehouses.success,
                total: warehouses.total || 0,
                dataCount: warehouses.data ? warehouses.data.length : 0,
                firstWarehouse: warehouses.data && warehouses.data.length > 0 ? {
                    id: warehouses.data[0].id,
                    code: warehouses.data[0].code,
                    description: warehouses.data[0].description,
                    active: warehouses.data[0].active
                } : null
            };

            console.log('✅ RESULTADO:');
            console.log('   • Respuesta exitosa:', results.warehouses.statusResponse);
            console.log('   • Total de almacenes:', results.warehouses.total);
            console.log('   • Almacenes en respuesta:', results.warehouses.dataCount);
            
            if (results.warehouses.firstWarehouse) {
                console.log('   • Primer almacén:');
                console.log('     - ID:', results.warehouses.firstWarehouse.id);
                console.log('     - Código:', results.warehouses.firstWarehouse.code);
                console.log('     - Descripción:', results.warehouses.firstWarehouse.description);
                console.log('     - Activo:', results.warehouses.firstWarehouse.active);
            }
            
            console.log('');
            console.log('📋 RESPUESTA COMPLETA:');
            console.log(JSON.stringify(warehouses, null, 2));
            console.log('');

        } catch (error) {
            results.warehouses = {
                success: false,
                error: error.message,
                isUnauthorizedEndpoint: error.isUnauthorizedEndpoint || false,
                statusCode: error.response?.status,
                errorData: error.response?.data
            };

            console.log('❌ ERROR:');
            console.log('   • Mensaje:', results.warehouses.error);
            console.log('   • Status Code:', results.warehouses.statusCode);
            console.log('   • Es endpoint no autorizado:', results.warehouses.isUnauthorizedEndpoint);
            
            if (results.warehouses.errorData) {
                console.log('   • Datos del error:');
                console.log(JSON.stringify(results.warehouses.errorData, null, 6));
            }
            console.log('');
        }

        // ===================================================================
        // ETAPA 3: CONSULTAR ITEMS (INVENTARIO)
        // ===================================================================
        console.log('┌─────────────────────────────────────────────────────────────┐');
        console.log('│ ETAPA 3: CONSULTAR ITEMS (INVENTARIO)                       │');
        console.log('└─────────────────────────────────────────────────────────────┘');
        console.log('📡 Endpoint: GET /items');
        console.log('📍 URL:', `${client.baseURL}/items`);
        console.log('');

        try {
            const items = await client.getAllInventories({ limit: 5 });
            
            results.items = {
                success: true,
                statusResponse: items.success,
                total: items.total || 0,
                dataCount: items.data ? items.data.length : 0,
                firstItem: items.data && items.data.length > 0 ? {
                    id: items.data[0].id,
                    code: items.data[0].code,
                    field_1: items.data[0].field_1,
                    id_type_item: items.data[0].id_type_item,
                    active: items.data[0].active,
                    hasWarehouses: items.data[0].warehouses && items.data[0].warehouses.length > 0
                } : null
            };

            console.log('✅ RESULTADO:');
            console.log('   • Respuesta exitosa:', results.items.statusResponse);
            console.log('   • Total de items:', results.items.total);
            console.log('   • Items en respuesta:', results.items.dataCount);
            
            if (results.items.firstItem) {
                console.log('   • Primer item:');
                console.log('     - ID:', results.items.firstItem.id);
                console.log('     - Código:', results.items.firstItem.code);
                console.log('     - Nombre (field_1):', results.items.firstItem.field_1);
                console.log('     - Tipo:', results.items.firstItem.id_type_item);
                console.log('     - Activo:', results.items.firstItem.active);
                console.log('     - Tiene almacenes asociados:', results.items.firstItem.hasWarehouses);
            }
            
            console.log('');
            console.log('📋 RESPUESTA COMPLETA:');
            console.log(JSON.stringify(items, null, 2));
            console.log('');

        } catch (error) {
            results.items = {
                success: false,
                error: error.message,
                isUnauthorizedEndpoint: error.isUnauthorizedEndpoint || false,
                statusCode: error.response?.status,
                errorData: error.response?.data
            };

            console.log('❌ ERROR:');
            console.log('   • Mensaje:', results.items.error);
            console.log('   • Status Code:', results.items.statusCode);
            console.log('   • Es endpoint no autorizado:', results.items.isUnauthorizedEndpoint);
            
            if (results.items.errorData) {
                console.log('   • Datos del error:');
                console.log(JSON.stringify(results.items.errorData, null, 6));
            }
            console.log('');
        }

        // ===================================================================
        // ETAPA 4: CONSULTAR UN ITEM ESPECÍFICO (si hay items)
        // ===================================================================
        if (results.items.success && results.items.firstItem) {
            console.log('┌─────────────────────────────────────────────────────────────┐');
            console.log('│ ETAPA 4: CONSULTAR ITEM ESPECÍFICO                          │');
            console.log('└─────────────────────────────────────────────────────────────┘');
            console.log('📡 Endpoint: GET /items/{code}');
            console.log('📍 URL:', `${client.baseURL}/items/${results.items.firstItem.code}`);
            console.log('');

            try {
                const specificItem = await client.getInventoryByCode(results.items.firstItem.code);
                
                const itemData = Array.isArray(specificItem.data) ? specificItem.data[0] : specificItem.data;
                
                results.specificItem = {
                    success: true,
                    statusResponse: specificItem.success,
                    item: {
                        id: itemData.id,
                        code: itemData.code,
                        field_1: itemData.field_1,
                        field_2: itemData.field_2,
                        field_3: itemData.field_3,
                        id_type_item: itemData.id_type_item,
                        warehousesCount: itemData.warehouses ? itemData.warehouses.length : 0,
                        warehouses: itemData.warehouses || []
                    }
                };

                console.log('✅ RESULTADO:');
                console.log('   • Respuesta exitosa:', results.specificItem.statusResponse);
                console.log('   • Código:', results.specificItem.item.code);
                console.log('   • Nombre:', results.specificItem.item.field_1);
                console.log('   • Fabricante:', results.specificItem.item.field_2 || 'N/A');
                console.log('   • Modelo:', results.specificItem.item.field_3 || 'N/A');
                console.log('   • Almacenes asociados:', results.specificItem.item.warehousesCount);
                
                if (results.specificItem.item.warehousesCount > 0) {
                    console.log('   • Datos de almacenes:');
                    results.specificItem.item.warehouses.forEach((wh, idx) => {
                        console.log(`     ${idx + 1}. ${wh.code_warehouse}:`);
                        console.log(`        Stock: ${wh.stock || 0}`);
                        console.log(`        Costo unitario: ${wh.unit_cost_stock || 0}`);
                        console.log(`        Ubicación: ${wh.location || 'N/A'}`);
                    });
                }
                
                console.log('');
                console.log('📋 RESPUESTA COMPLETA:');
                console.log(JSON.stringify(specificItem, null, 2));
                console.log('');

            } catch (error) {
                results.specificItem = {
                    success: false,
                    error: error.message,
                    statusCode: error.response?.status,
                    errorData: error.response?.data
                };

                console.log('❌ ERROR:');
                console.log('   • Mensaje:', results.specificItem.error);
                console.log('   • Status Code:', results.specificItem.statusCode);
                
                if (results.specificItem.errorData) {
                    console.log('   • Datos del error:');
                    console.log(JSON.stringify(results.specificItem.errorData, null, 6));
                }
                console.log('');
            }
        }

        // ===================================================================
        // RESUMEN FINAL
        // ===================================================================
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('📊 RESUMEN DE RESULTADOS');
        console.log('═══════════════════════════════════════════════════════════════');
        console.log('');
        console.log('1. Autenticación:', results.authentication.success ? '✅ EXITOSA' : '❌ FALLIDA');
        console.log('2. Almacenes:', results.warehouses.success ? '✅ EXITOSO' : '❌ FALLIDO');
        console.log('3. Items:', results.items.success ? '✅ EXITOSO' : '❌ FALLIDO');
        console.log('4. Item específico:', results.specificItem ? (results.specificItem.success ? '✅ EXITOSO' : '❌ FALLIDO') : '⏭️  OMITIDO');
        console.log('');

        // Guardar resultados en archivo JSON
        const fs = require('fs');
        const path = require('path');
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const logPath = path.join(__dirname, '../../logs', `test-api-results-${timestamp}.json`);
        
        fs.writeFileSync(logPath, JSON.stringify(results, null, 2));
        console.log('💾 Resultados guardados en:', logPath);
        console.log('');

    } catch (error) {
        console.error('═══════════════════════════════════════════════════════════════');
        console.error('💥 ERROR CRÍTICO EN TEST');
        console.error('═══════════════════════════════════════════════════════════════');
        console.error('');
        console.error('Mensaje:', error.message);
        console.error('Stack:', error.stack);
        console.error('');
        process.exit(1);
    }
}

// Ejecutar test
testWithDetailedLogs().catch(error => {
    console.error('Error no capturado:', error);
    process.exit(1);
});
