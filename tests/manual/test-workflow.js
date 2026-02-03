const FracttalClient = require('../../src/services/fracttalClient');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

/**
 * Test de Flujo Completo - Emula el flujo de trabajo de SageSync
 *
 * Prueba el flujo REAL de produccion:
 * 1. Autenticacion con Fracttal
 * 2. Verificacion/creacion de almacen
 * 3. Creacion de items CON asociacion a almacen (POST /inventories/)
 * 4. Verificacion de stock en almacen (GET /warehouses_items/)
 * 5. Ajuste de inventario (PUT /inventories_adjustment/)
 * 6. Verificacion de stock ajustado
 * 7. Consulta de item con detalle de almacenes (GET /inventories/)
 * 8. Resumen completo
 *
 * Usa el almacen TEST001 del sandbox
 */

const WAREHOUSE_CODE = 'TEST001';

class FracttalWorkflowTest {
    constructor() {
        this.client = new FracttalClient();
        this.results = {
            timestamp: new Date().toISOString(),
            warehouseCode: WAREHOUSE_CODE,
            steps: {},
            itemsCreated: [],
            errors: []
        };
        this.dummyItems = [];
    }

    log(title, data = '') {
        const msg = `${title} ${data}`;
        console.log(msg);
    }

    logSection(title) {
        console.log('\n' + '='.repeat(70));
        console.log(`${title}`);
        console.log('='.repeat(70) + '\n');
    }

    logStep(number, title) {
        console.log(`\n+---------------------------------------------------------+`);
        console.log(`| PASO ${number}: ${title.padEnd(50)} |`);
        console.log(`+---------------------------------------------------------+\n`);
    }

    logSuccess(message, details = null) {
        console.log(`  [OK] ${message}`);
        if (details) {
            Object.entries(details).forEach(([key, value]) => {
                console.log(`       - ${key}: ${value}`);
            });
        }
    }

    logError(message, error = null) {
        console.log(`  [FAIL] ${message}`);
        if (error) {
            console.log(`       - Error: ${error.message}`);
            if (error.response?.status) {
                console.log(`       - Status: ${error.response.status}`);
            }
            if (error.response?.data) {
                console.log(`       - Datos: ${JSON.stringify(error.response.data).substring(0, 300)}`);
            }
        }
    }

    logInfo(message) {
        console.log(`  [INFO] ${message}`);
    }

    // Generar datos dummy de items como si vinieran de Sage
    generateDummyItems() {
        const shortId = Date.now().toString().slice(-6);
        return [
            {
                ItemNumber: 'HERR-TAL-' + shortId,
                Description: 'Taladro neumatico industrial HD-2800',
                Location: 'TEST',
                QuantityOnHand: 8,
                MinimumStock: 2,
                LastCost: 2500.00,
                type: 3  // Herramientas
            },
            {
                ItemNumber: 'REPU-ROD-' + shortId,
                Description: 'Rodamientos SKF 6308 2RS',
                Location: 'TEST',
                QuantityOnHand: 245,
                MinimumStock: 50,
                LastCost: 85.50,
                type: 4  // Repuestos
            },
            {
                ItemNumber: 'REPU-SEL-' + shortId,
                Description: 'Sellos de aceite sinteticos DIN 2380',
                Location: 'TEST',
                QuantityOnHand: 1200,
                MinimumStock: 200,
                LastCost: 12.75,
                type: 4  // Repuestos
            },
            {
                ItemNumber: 'COMP-MOT-' + shortId,
                Description: 'Motor electrico trifasico 15HP 1800RPM',
                Location: 'TEST',
                QuantityOnHand: 5,
                MinimumStock: 1,
                LastCost: 3200.00,
                type: 4  // Repuestos (using 4 for components too since Fracttal uses 3=tool, 4=spare)
            },
            {
                ItemNumber: 'SUMIN-LUB-' + shortId,
                Description: 'Aceite hidraulico ISO VG 46 200L',
                Location: 'TEST',
                QuantityOnHand: 18,
                MinimumStock: 5,
                LastCost: 450.00,
                type: 4  // Repuestos
            }
        ];
    }

    // Convert Sage item to Fracttal /inventories/ format (WITH warehouse)
    convertSageToFracttalInventory(sageItem, warehouseCode) {
        return {
            code: sageItem.ItemNumber.substring(0, 50),
            field_1: sageItem.Description.substring(0, 100),
            field_2: '',
            field_3: '',
            field_4: '',
            id_type_item: sageItem.type === 3 ? 3 : 4,
            code_warehouse: warehouseCode,
            unit_code: 'UN',
            unit_description: 'Unidad',
            stock: sageItem.QuantityOnHand,
            unit_cost_stock: sageItem.LastCost,
            min_stock_level: sageItem.MinimumStock,
            max_stock_level: sageItem.MinimumStock * 3,
            barcode: sageItem.ItemNumber,
            notes: `Sincronizado desde Sage300 - ${new Date().toISOString()}`
        };
    }

    async run() {
        try {
            this.logSection('TEST DE FLUJO COMPLETO - SAGESYNC CON ALMACEN');
            console.log(`  Almacen objetivo: ${WAREHOUSE_CODE}`);
            console.log(`  Fecha: ${new Date().toISOString()}\n`);

            // PASO 1: Autenticacion
            await this.testAuthentication();

            // PASO 2: Verificar almacen
            await this.testVerifyWarehouse();

            // PASO 3: Generar items dummy
            await this.testGenerateItems();

            // PASO 4: Crear items CON almacen (POST /inventories/)
            await this.testCreateItemsWithWarehouse();

            // PASO 5: Setear stock inicial via ajuste (PUT /inventories_adjustment/)
            await this.testSetInitialStock();

            // PASO 6: Verificar stock en almacen (GET /warehouses_items/)
            await this.testVerifyWarehouseStock();

            // PASO 7: Simular cambio de stock desde Sage (ajuste)
            await this.testAdjustInventory();

            // PASO 8: Verificar stock ajustado
            await this.testVerifyAdjustedStock();

            // PASO 9: Consultar item con detalle (GET /inventories/)
            await this.testQueryItemInventory();

            // PASO 10: Resumen
            await this.testCompleteSummary();

            // Guardar resultados
            await this.saveResults();

            this.logSection('TEST COMPLETADO');
            this.printSummary();

        } catch (error) {
            this.logError('ERROR NO MANEJADO', error);
            this.results.errors.push({
                step: 'general',
                message: error.message,
                stack: error.stack
            });
            await this.saveResults();
            process.exit(1);
        }
    }

    async testAuthentication() {
        this.logStep(1, 'AUTENTICACION CON FRACTTAL');

        try {
            const token = await this.client.authenticate();

            this.results.steps.authentication = {
                success: true,
                tokenLength: token.length,
                expiry: this.client.tokenExpiry.toISOString()
            };

            this.logSuccess('Autenticacion exitosa', {
                'Token length': token.length,
                'Expira': this.client.tokenExpiry.toISOString()
            });

        } catch (error) {
            this.logError('Fallo en autenticacion', error);
            throw error;
        }
    }

    async testVerifyWarehouse() {
        this.logStep(2, 'VERIFICAR ALMACEN ' + WAREHOUSE_CODE);

        try {
            // List all warehouses first
            const warehouses = await this.client.getAllWarehouses({ limit: 50 });
            const whList = warehouses.data || [];

            this.logInfo(`Almacenes en el sistema: ${whList.length}`);
            whList.forEach((w, idx) => {
                const marker = w.code === WAREHOUSE_CODE ? ' <-- TARGET' : '';
                console.log(`       ${idx + 1}. ${w.code} - ${w.description}${marker}`);
            });

            // Verify target warehouse exists
            const target = whList.find(w => w.code === WAREHOUSE_CODE);
            if (target) {
                this.logSuccess(`Almacen ${WAREHOUSE_CODE} encontrado`, {
                    'Codigo': target.code,
                    'Descripcion': target.description
                });
                this.results.steps.verifyWarehouse = { success: true, warehouse: target };
            } else {
                this.logInfo(`Almacen ${WAREHOUSE_CODE} no existe, creandolo...`);
                const newWh = await this.client.ensureWarehouseExists(WAREHOUSE_CODE);
                this.logSuccess(`Almacen ${WAREHOUSE_CODE} creado`);
                this.results.steps.verifyWarehouse = { success: true, warehouse: newWh, created: true };
            }

        } catch (error) {
            this.logError('Fallo al verificar almacen', error);
            this.results.steps.verifyWarehouse = { success: false, error: error.message };
            throw error;
        }
    }

    async testGenerateItems() {
        this.logStep(3, 'GENERAR Y CONVERTIR ITEMS (SAGE -> FRACTTAL)');

        try {
            const sageItems = this.generateDummyItems();

            this.dummyItems = sageItems.map(item => ({
                sageData: item,
                fracttalData: this.convertSageToFracttalInventory(item, WAREHOUSE_CODE)
            }));

            this.logSuccess(`Se generaron ${this.dummyItems.length} items`);

            console.log('');
            this.dummyItems.forEach((item, idx) => {
                console.log(`       ${idx + 1}. ${item.sageData.ItemNumber}`);
                console.log(`          Desc: ${item.fracttalData.field_1}`);
                console.log(`          Almacen: ${item.fracttalData.code_warehouse}`);
                console.log(`          Stock: ${item.fracttalData.stock} | Costo: $${item.fracttalData.unit_cost_stock}`);
                console.log(`          Min: ${item.fracttalData.min_stock_level} | Max: ${item.fracttalData.max_stock_level}`);
                console.log('');
            });

            this.results.steps.generateItems = {
                success: true,
                count: this.dummyItems.length,
                items: this.dummyItems.map(i => ({
                    code: i.sageData.ItemNumber,
                    warehouse: i.fracttalData.code_warehouse,
                    stock: i.fracttalData.stock
                }))
            };

        } catch (error) {
            this.logError('Fallo en generacion de items', error);
            throw error;
        }
    }

    async testCreateItemsWithWarehouse() {
        this.logStep(4, 'CREAR ITEMS EN ALMACEN (POST /inventories/)');

        this.logInfo(`Creando ${this.dummyItems.length} items en almacen ${WAREHOUSE_CODE}...\n`);

        let created = 0;
        let failed = 0;

        for (let i = 0; i < this.dummyItems.length; i++) {
            const item = this.dummyItems[i];

            try {
                console.log(`       [${i + 1}/${this.dummyItems.length}] Creando: ${item.fracttalData.code} -> almacen ${WAREHOUSE_CODE}`);

                const response = await this.client.createInventoryWithWarehouse(item.fracttalData);

                if (response.success && response.data) {
                    const createdItem = response.data;
                    this.results.itemsCreated.push({
                        code: createdItem.code,
                        id: createdItem.id,
                        description: createdItem.field_1 || createdItem.description,
                        stock: item.fracttalData.stock,
                        warehouse: WAREHOUSE_CODE
                    });

                    console.log(`         -> OK (ID: ${createdItem.id})`);
                    created++;
                } else {
                    throw new Error('Respuesta sin success o data');
                }

            } catch (error) {
                console.log(`         -> FAIL: ${error.message}`);
                if (error.response?.data) {
                    console.log(`         -> API: ${JSON.stringify(error.response.data).substring(0, 200)}`);
                }
                this.results.errors.push({
                    step: 'createItems',
                    item: item.fracttalData.code,
                    error: error.message,
                    apiResponse: error.response?.data
                });
                failed++;
            }
        }

        console.log('');
        this.logSuccess(`Resultados: ${created} creados, ${failed} fallidos`);

        this.results.steps.createItems = {
            success: created > 0,
            created,
            failed,
            total: this.dummyItems.length
        };
    }

    async testSetInitialStock() {
        this.logStep(5, 'SETEAR STOCK INICIAL (PUT /inventories_adjustment/)');

        if (this.results.itemsCreated.length === 0) {
            this.logInfo('Se omite - no hay items creados');
            this.results.steps.setInitialStock = { success: false, skipped: true };
            return;
        }

        this.logInfo(`POST /inventories/ crea el item en el almacen pero stock inicia en 0.`);
        this.logInfo(`Se usa PUT /inventories_adjustment/ para setear stock real de Sage.\n`);

        let adjusted = 0;
        let failedAdj = 0;

        for (let i = 0; i < this.results.itemsCreated.length; i++) {
            const item = this.results.itemsCreated[i];
            const sageItem = this.dummyItems[i];
            const targetStock = sageItem.fracttalData.stock;
            const targetCost = sageItem.fracttalData.unit_cost_stock;

            try {
                console.log(`       [${i + 1}/${this.results.itemsCreated.length}] ${item.code}: stock=${targetStock}, costo=$${targetCost}`);

                const adjData = {
                    code_warehouse: WAREHOUSE_CODE,
                    stock: targetStock,
                    unit_cost_stock: targetCost
                };

                const resp = await this.client.adjustInventoryStock(item.code, adjData);

                if (resp.success && resp.data) {
                    console.log(`         -> OK (stock: ${resp.data.stock}, costo: $${resp.data.unit_cost_stock})`);
                    adjusted++;
                } else {
                    throw new Error('Respuesta sin success o data');
                }

            } catch (error) {
                console.log(`         -> FAIL: ${error.message}`);
                failedAdj++;
                this.results.errors.push({
                    step: 'setInitialStock',
                    item: item.code,
                    error: error.message
                });
            }
        }

        console.log('');
        this.logSuccess(`Stock inicial: ${adjusted} ajustados, ${failedAdj} fallidos`);

        this.results.steps.setInitialStock = {
            success: adjusted > 0,
            adjusted,
            failed: failedAdj
        };
    }

    async testVerifyWarehouseStock() {
        this.logStep(6, 'VERIFICAR STOCK EN ALMACEN (GET /warehouses_items/)');

        if (this.results.itemsCreated.length === 0) {
            this.logInfo('Se omite - no hay items creados');
            this.results.steps.verifyStock = { success: false, skipped: true };
            return;
        }

        try {
            const warehouseStock = await this.client.getWarehouseStock(WAREHOUSE_CODE, { limit: 100 });

            if (warehouseStock.success && warehouseStock.data) {
                const stockItems = warehouseStock.data;
                const createdCodes = this.results.itemsCreated.map(i => i.code);
                const foundItems = stockItems.filter(i => createdCodes.includes(i.code));

                this.logSuccess(`Stock del almacen ${WAREHOUSE_CODE}`, {
                    'Total items en almacen': warehouseStock.total || stockItems.length,
                    'Items creados encontrados': foundItems.length
                });

                if (foundItems.length > 0) {
                    console.log('');
                    console.log('       Items con stock en almacen:');
                    foundItems.forEach((item, idx) => {
                        console.log(`       ${idx + 1}. ${item.code} - ${item.description || item.field_1 || 'N/A'}`);
                        console.log(`          Stock: ${item.stock} | Costo: $${item.unit_cost_stock}`);
                        console.log(`          Min: ${item.min_stock_level} | Max: ${item.max_stock_level}`);
                    });
                }

                this.results.steps.verifyStock = {
                    success: true,
                    totalInWarehouse: warehouseStock.total || stockItems.length,
                    createdItemsFound: foundItems.length,
                    stockDetails: foundItems.map(i => ({
                        code: i.code,
                        stock: i.stock,
                        unit_cost_stock: i.unit_cost_stock
                    }))
                };
            } else {
                this.logError('Respuesta sin datos de stock');
                this.results.steps.verifyStock = { success: false };
            }

        } catch (error) {
            this.logError('Fallo al verificar stock', error);
            this.results.steps.verifyStock = { success: false, error: error.message };
        }
    }

    async testAdjustInventory() {
        this.logStep(7, 'SIMULAR CAMBIO SAGE (PUT /inventories_adjustment/)');

        if (this.results.itemsCreated.length === 0) {
            this.logInfo('Se omite - no hay items creados');
            this.results.steps.adjustInventory = { success: false, skipped: true };
            return;
        }

        // Pick first item to adjust
        const targetItem = this.results.itemsCreated[0];
        const originalStock = targetItem.stock;
        const newStock = originalStock + 50;
        const newCost = 99.99;

        this.logInfo(`Ajustando item: ${targetItem.code}`);
        this.logInfo(`Stock: ${originalStock} -> ${newStock}`);
        this.logInfo(`Costo: -> $${newCost}\n`);

        try {
            const adjustmentData = {
                code_warehouse: WAREHOUSE_CODE,
                stock: newStock,
                unit_cost_stock: newCost,
                min_stock_level: 10,
                max_stock_level: newStock * 2
            };

            const response = await this.client.adjustInventoryStock(targetItem.code, adjustmentData);

            if (response.success && response.data) {
                this.logSuccess(`Inventario ajustado exitosamente`, {
                    'Item': targetItem.code,
                    'Nuevo stock': response.data.stock,
                    'Nuevo costo': response.data.unit_cost_stock
                });

                this.results.steps.adjustInventory = {
                    success: true,
                    item: targetItem.code,
                    originalStock,
                    newStock,
                    newCost,
                    responseStock: response.data.stock,
                    responseCost: response.data.unit_cost_stock
                };
            } else {
                throw new Error('Respuesta sin success o data');
            }

        } catch (error) {
            this.logError('Fallo al ajustar inventario', error);
            this.results.steps.adjustInventory = { success: false, error: error.message };
        }
    }

    async testVerifyAdjustedStock() {
        this.logStep(8, 'VERIFICAR STOCK AJUSTADO');

        if (!this.results.steps.adjustInventory?.success) {
            this.logInfo('Se omite - ajuste no fue exitoso');
            this.results.steps.verifyAdjusted = { success: false, skipped: true };
            return;
        }

        const adjustedItem = this.results.steps.adjustInventory.item;

        try {
            const itemInventory = await this.client.getItemInventory(adjustedItem);

            if (itemInventory.success && itemInventory.data) {
                const itemData = Array.isArray(itemInventory.data) ? itemInventory.data[0] : itemInventory.data;
                const whData = itemData.warehouses?.find(w => w.code_warehouse === WAREHOUSE_CODE);

                if (whData) {
                    this.logSuccess(`Stock verificado para ${adjustedItem}`, {
                        'Almacen': whData.code_warehouse,
                        'Stock actual': whData.stock,
                        'Costo unitario': whData.unit_cost_stock,
                        'Stock min': whData.min_stock_level,
                        'Stock max': whData.max_stock_level
                    });

                    this.results.steps.verifyAdjusted = {
                        success: true,
                        item: adjustedItem,
                        warehouse: WAREHOUSE_CODE,
                        stock: whData.stock,
                        unit_cost_stock: whData.unit_cost_stock
                    };
                } else {
                    this.logError(`Item ${adjustedItem} no tiene almacen ${WAREHOUSE_CODE} asociado`);
                    this.logInfo(`Almacenes del item: ${JSON.stringify(itemData.warehouses)}`);
                    this.results.steps.verifyAdjusted = { success: false, noWarehouse: true };
                }
            } else {
                throw new Error('Respuesta sin datos');
            }

        } catch (error) {
            this.logError('Fallo al verificar stock ajustado', error);
            this.results.steps.verifyAdjusted = { success: false, error: error.message };
        }
    }

    async testQueryItemInventory() {
        this.logStep(9, 'CONSULTA DETALLADA DE ITEMS (GET /inventories/)');

        if (this.results.itemsCreated.length === 0) {
            this.logInfo('Se omite - no hay items creados');
            this.results.steps.queryInventory = { success: false, skipped: true };
            return;
        }

        try {
            let queriedCount = 0;

            // Query up to 3 items for demo
            const itemsToQuery = this.results.itemsCreated.slice(0, 3);

            for (const item of itemsToQuery) {
                try {
                    const inv = await this.client.getItemInventory(item.code);

                    if (inv.success && inv.data) {
                        const itemData = Array.isArray(inv.data) ? inv.data[0] : inv.data;
                        const warehouses = itemData.warehouses || [];

                        console.log(`\n       Item: ${itemData.code}`);
                        console.log(`       Descripcion: ${itemData.description || itemData.field_1}`);
                        console.log(`       ID Fracttal: ${itemData.id}`);
                        console.log(`       Tipo: ${itemData.id_type_item}`);
                        console.log(`       Almacenes asociados: ${warehouses.length}`);

                        warehouses.forEach(wh => {
                            console.log(`         - ${wh.code_warehouse}: stock=${wh.stock}, costo=$${wh.unit_cost_stock}, min=${wh.min_stock_level}, max=${wh.max_stock_level}`);
                        });

                        queriedCount++;
                    }

                } catch (err) {
                    console.log(`\n       Item: ${item.code} -> ERROR: ${err.message}`);
                }
            }

            console.log('');
            this.logSuccess(`Se consultaron ${queriedCount}/${itemsToQuery.length} items con detalle`);

            this.results.steps.queryInventory = {
                success: queriedCount > 0,
                queried: queriedCount,
                attempted: itemsToQuery.length
            };

        } catch (error) {
            this.logError('Fallo en consulta de inventario', error);
            this.results.steps.queryInventory = { success: false, error: error.message };
        }
    }

    async testCompleteSummary() {
        this.logStep(10, 'RESUMEN DE FLUJO COMPLETO');

        const steps = [
            { name: 'Autenticacion', key: 'authentication' },
            { name: 'Verificar Almacen', key: 'verifyWarehouse' },
            { name: 'Generar Items', key: 'generateItems' },
            { name: 'Crear Items en Almacen', key: 'createItems' },
            { name: 'Setear Stock Inicial', key: 'setInitialStock' },
            { name: 'Verificar Stock', key: 'verifyStock' },
            { name: 'Simular Cambio Sage', key: 'adjustInventory' },
            { name: 'Verificar Ajuste', key: 'verifyAdjusted' },
            { name: 'Consulta Detallada', key: 'queryInventory' }
        ];

        console.log('  Flujo de sincronizacion completo:\n');

        steps.forEach((step, idx) => {
            const result = this.results.steps[step.key];
            const status = result?.success === true ? 'OK' : result?.skipped ? 'SKIP' : 'FAIL';
            const icon = status === 'OK' ? '[OK]  ' : status === 'SKIP' ? '[SKIP]' : '[FAIL]';
            console.log(`       ${idx + 1}. ${icon} ${step.name}`);
        });

        console.log('\n  Estadisticas:');
        console.log(`       - Almacen usado: ${WAREHOUSE_CODE}`);
        console.log(`       - Items creados en almacen: ${this.results.itemsCreated.length}`);
        console.log(`       - Errores: ${this.results.errors.length}`);
        console.log(`       - Pasos completados: ${steps.filter(s => this.results.steps[s.key]?.success).length}/${steps.length}`);

        this.results.summary = {
            warehouseCode: WAREHOUSE_CODE,
            totalSteps: steps.length,
            completedSteps: steps.filter(s => this.results.steps[s.key]?.success).length,
            itemsCreated: this.results.itemsCreated.length,
            errors: this.results.errors.length,
            readyForProduction: this.results.itemsCreated.length > 0 &&
                this.results.steps.setInitialStock?.success === true &&
                this.results.steps.verifyStock?.success === true &&
                this.results.steps.adjustInventory?.success === true
        };
    }

    async saveResults() {
        try {
            const logsDir = path.join(__dirname, '../../logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `test-workflow-${timestamp}.json`;
            const filepath = path.join(logsDir, filename);

            fs.writeFileSync(filepath, JSON.stringify(this.results, null, 2));
            console.log(`\n  Resultados guardados en: logs/${filename}`);

        } catch (error) {
            console.error('  No se pudieron guardar los resultados:', error.message);
        }
    }

    printSummary() {
        if (this.results.summary) {
            const s = this.results.summary;

            console.log('\n  RESUMEN FINAL');
            console.log('  ' + '='.repeat(60));
            console.log(`  Almacen: ${s.warehouseCode}`);
            console.log(`  Pasos completados: ${s.completedSteps}/${s.totalSteps}`);
            console.log(`  Items creados con stock: ${s.itemsCreated}`);
            console.log(`  Errores: ${s.errors}`);
            console.log(`  Listo para produccion: ${s.readyForProduction ? 'SI' : 'NO'}`);
            console.log('  ' + '='.repeat(60) + '\n');
        }
    }
}

// Ejecutar test
const test = new FracttalWorkflowTest();
test.run().catch(error => {
    console.error('Error fatal:', error);
    process.exit(1);
});
