const FracttalClient = require('../../src/services/fracttalClient');
require('dotenv').config();
const fs = require('fs');
const path = require('path');

/**
 * Test de Flujo Completo - Emula el flujo de trabajo de SageSync
 * 
 * Prueba:
 * 1. Autenticación con Fracttal
 * 2. Verificación de almacenes disponibles
 * 3. Creación de items (activos)
 * 4. Actualización de items
 * 5. Consulta de items creados
 * 
 * NO requiere:
 * - Base de datos Sage300
 * - Datos reales (usa datos dummy)
 */

class FracttalWorkflowTest {
    constructor() {
        this.client = new FracttalClient();
        this.results = {
            timestamp: new Date().toISOString(),
            steps: {},
            itemsCreated: [],
            errors: []
        };
        this.logFile = null;
    }

    log(title, data = '') {
        const msg = `${title} ${data}`;
        console.log(msg);
    }

    logSection(title) {
        console.log('\n' + '═'.repeat(70));
        console.log(`${title}`);
        console.log('═'.repeat(70) + '\n');
    }

    logStep(number, title) {
        console.log(`\n┌─────────────────────────────────────────────────────────────┐`);
        console.log(`│ PASO ${number}: ${title.padEnd(55)} │`);
        console.log(`└─────────────────────────────────────────────────────────────┘\n`);
    }

    logSuccess(message, details = null) {
        console.log(`✅ ${message}`);
        if (details) {
            Object.entries(details).forEach(([key, value]) => {
                console.log(`   • ${key}: ${value}`);
            });
        }
    }

    logError(message, error = null) {
        console.log(`❌ ${message}`);
        if (error) {
            console.log(`   • Error: ${error.message}`);
            if (error.response?.status) {
                console.log(`   • Status: ${error.response.status}`);
            }
            if (error.response?.data) {
                console.log(`   • Datos: ${JSON.stringify(error.response.data)}`);
            }
        }
    }

    // Generar datos dummy de items como si vinieran de Sage
    generateDummyItems() {
        return [
            {
                ItemNumber: 'TEST-001-' + Date.now(),
                Description: 'Repuesto de prueba 1',
                Location: 'LOC-001',
                QuantityOnHand: 50,
                MinimumStock: 10,
                LastCost: 150.00
            },
            {
                ItemNumber: 'TEST-002-' + Date.now(),
                Description: 'Herramienta de prueba',
                Location: 'LOC-002',
                QuantityOnHand: 25,
                MinimumStock: 5,
                LastCost: 500.00
            },
            {
                ItemNumber: 'TEST-003-' + Date.now(),
                Description: 'Componente de prueba',
                Location: 'LOC-001',
                QuantityOnHand: 100,
                MinimumStock: 20,
                LastCost: 75.50
            }
        ];
    }

    // Convertir item Sage a formato Fracttal
    convertSageToFracttal(sageItem, warehouseCode = 'TEST-WH') {
        return {
            code: sageItem.ItemNumber.substring(0, 50), // Fracttal limita a 50 caracteres
            id_type_item: 4, // Repuestos y suministros
            field_1: sageItem.Description.substring(0, 100), // Nombre
            field_2: '', // Fabricante (vacío para dummy)
            field_3: '', // Modelo (vacío para dummy)
            field_4: '', // Serial (vacío para dummy)
            field_5: '', // Otros 1
            field_6: '', // Otros 2
            unit_code: 'UN',
            unit_description: 'Unidad',
            barcode: sageItem.ItemNumber,
            notes: `Sincronizado desde Sage300 - ${new Date().toISOString()}`
        };
    }

    async run() {
        try {
            this.logSection('🧪 TEST DE FLUJO COMPLETO - SAGESYNC SIN BASE DE DATOS');

            // PASO 1: Autenticación
            await this.testAuthentication();

            // PASO 2: Listar almacenes
            await this.testListWarehouses();

            // PASO 3: Generar items dummy y convertirlos
            await this.testItemConversion();

            // PASO 4: Crear items en Fracttal
            await this.testCreateItems();

            // PASO 5: Listar items creados
            await this.testListItems();

            // PASO 6: Actualizar item
            if (this.results.itemsCreated.length > 0) {
                await this.testUpdateItem();
            }

            // PASO 7: Simular sincronización completa
            await this.testCompleteSync();

            // Guardar resultados
            await this.saveResults();

            this.logSection('✨ TEST COMPLETADO EXITOSAMENTE');
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
        this.logStep(1, 'AUTENTICACIÓN CON FRACTTAL');

        try {
            const token = await this.client.authenticate();

            this.results.steps.authentication = {
                success: true,
                token: token.substring(0, 30) + '...',
                tokenLength: token.length,
                expiry: this.client.tokenExpiry.toISOString(),
                hasRefreshToken: !!this.client.refreshToken
            };

            this.logSuccess('Autenticación exitosa', {
                'Token length': token.length,
                'Expira en': this.client.tokenExpiry.toISOString(),
                'Refresh token': this.client.refreshToken ? 'SÍ' : 'NO'
            });

        } catch (error) {
            this.logError('Fallo en autenticación', error);
            throw error;
        }
    }

    async testListWarehouses() {
        this.logStep(2, 'LISTAR ALMACENES DISPONIBLES');

        try {
            const warehouses = await this.client.getAllWarehouses({ limit: 10 });

            if (!warehouses.success) {
                throw new Error('Respuesta sin success flag');
            }

            const count = warehouses.data ? warehouses.data.length : 0;

            this.results.steps.listWarehouses = {
                success: true,
                total: warehouses.total || count,
                returned: count,
                warehouses: warehouses.data ? warehouses.data.map(w => ({
                    id: w.id,
                    code: w.code,
                    description: w.description
                })) : []
            };

            this.logSuccess(`Se encontraron ${count} almacenes`, {
                'Total en sistema': warehouses.total || count,
                'Primeros 10': count
            });

            if (count > 0) {
                console.log('\n📋 Almacenes:');
                warehouses.data.slice(0, 5).forEach((w, idx) => {
                    console.log(`   ${idx + 1}. ${w.code} - ${w.description}`);
                });
            }

        } catch (error) {
            if (error.message?.includes('UNAUTHORIZED_ENDPOINT')) {
                this.logError('Módulo de almacenes no autorizado en tu cuenta', error);
                this.results.steps.listWarehouses = { success: false, unauthorized: true };
            } else {
                this.logError('Fallo al listar almacenes', error);
                throw error;
            }
        }
    }

    async testItemConversion() {
        this.logStep(3, 'GENERAR Y CONVERTIR ITEMS (SAGE → FRACTTAL)');

        try {
            const sageItems = this.generateDummyItems();

            const fracttalItems = sageItems.map(item => ({
                sageData: item,
                fracttalData: this.convertSageToFracttal(item)
            }));

            this.results.steps.itemConversion = {
                success: true,
                itemsGenerated: fracttalItems.length,
                items: fracttalItems.map(item => ({
                    sageCode: item.sageData.ItemNumber,
                    fracttalCode: item.fracttalData.code,
                    description: item.fracttalData.field_1,
                    type: item.fracttalData.id_type_item
                }))
            };

            this.logSuccess(`Se generaron ${fracttalItems.length} items dummy`, {
                'Items preparados': fracttalItems.length
            });

            console.log('\n📦 Items Generados:');
            fracttalItems.forEach((item, idx) => {
                console.log(`\n   ${idx + 1}. Sage: ${item.sageData.ItemNumber}`);
                console.log(`      → Fracttal: ${item.fracttalData.code}`);
                console.log(`      → Descripción: ${item.fracttalData.field_1}`);
                console.log(`      → Cantidad: ${item.sageData.QuantityOnHand}`);
                console.log(`      → Costo: $${item.sageData.LastCost}`);
            });

            // Guardar items generados para pasos siguientes
            this.dummyItems = fracttalItems;

        } catch (error) {
            this.logError('Fallo en conversión de items', error);
            throw error;
        }
    }

    async testCreateItems() {
        this.logStep(4, 'CREAR ITEMS EN FRACTTAL');

        console.log(`📡 Creando ${this.dummyItems.length} items...\n`);

        for (let i = 0; i < this.dummyItems.length; i++) {
            const item = this.dummyItems[i];

            try {
                console.log(`   [${i + 1}/${this.dummyItems.length}] Creando: ${item.fracttalData.code}`);

                const response = await this.client.createInventoryItem(item.fracttalData);

                if (response.success || response.data?.id) {
                    const createdItem = response.data || response;
                    this.results.itemsCreated.push({
                        code: createdItem.code,
                        id: createdItem.id,
                        description: createdItem.field_1
                    });

                    console.log(`      ✅ Creado exitosamente (ID: ${createdItem.id})`);
                } else {
                    throw new Error('Sin ID en respuesta');
                }

            } catch (error) {
                if (error.message?.includes('UNAUTHORIZED_ENDPOINT')) {
                    this.logError(`\n   ❌ Módulo de items no autorizado`, error);
                    this.results.steps.createItems = { 
                        success: false, 
                        unauthorized: true,
                        partial: this.results.itemsCreated.length > 0
                    };
                    break;
                } else {
                    console.log(`      ❌ Error: ${error.message}`);
                    this.results.errors.push({
                        step: 'createItems',
                        item: item.fracttalData.code,
                        error: error.message
                    });
                }
            }
        }

        if (this.results.itemsCreated.length > 0) {
            this.logSuccess(`Se crearon ${this.results.itemsCreated.length} items`, {
                'Items exitosos': this.results.itemsCreated.length,
                'Items fallidos': this.dummyItems.length - this.results.itemsCreated.length
            });

            this.results.steps.createItems = { 
                success: true, 
                created: this.results.itemsCreated.length 
            };
        }
    }

    async testListItems() {
        this.logStep(5, 'LISTAR ITEMS CREADOS');

        if (this.results.itemsCreated.length === 0) {
            console.log('⏭️  Se omite - no hay items creados\n');
            return;
        }

        try {
            const items = await this.client.getAllInventories({ limit: 10 });

            if (items.success && items.data) {
                const createdCodes = this.results.itemsCreated.map(i => i.code);
                const foundItems = items.data.filter(i => createdCodes.includes(i.code));

                this.logSuccess(`Se listaron items`, {
                    'Total en sistema': items.total || items.data.length,
                    'Items creados encontrados': foundItems.length
                });

                if (foundItems.length > 0) {
                    console.log('\n📋 Items Creados en Fracttal:');
                    foundItems.forEach((item, idx) => {
                        console.log(`   ${idx + 1}. ${item.code} - ${item.field_1}`);
                    });
                }

                this.results.steps.listItems = {
                    success: true,
                    found: foundItems.length,
                    total: items.total || items.data.length
                };
            }

        } catch (error) {
            if (error.message?.includes('UNAUTHORIZED_ENDPOINT')) {
                this.logError('Módulo de items no autorizado', error);
                this.results.steps.listItems = { success: false, unauthorized: true };
            } else {
                this.logError('Fallo al listar items', error);
            }
        }
    }

    async testUpdateItem() {
        this.logStep(6, 'ACTUALIZAR ITEM (SIMULAR CAMBIO DE INVENTARIO)');

        const itemToUpdate = this.results.itemsCreated[0];

        try {
            console.log(`📝 Actualizando: ${itemToUpdate.code}\n`);

            const updatedData = {
                field_1: itemToUpdate.description + ' [ACTUALIZADO]',
                id_type_item: 4, // Obligatorio en actualización
                notes: `Actualizado por test de flujo - ${new Date().toISOString()}`
            };

            const response = await this.client.updateInventoryItem(itemToUpdate.code, updatedData);

            this.logSuccess('Item actualizado exitosamente', {
                'Código': itemToUpdate.code,
                'Nueva descripción': updatedData.field_1
            });

            this.results.steps.updateItem = {
                success: true,
                itemCode: itemToUpdate.code,
                updated: Object.keys(updatedData)
            };

        } catch (error) {
            this.logError('Fallo al actualizar item', error);
            this.results.steps.updateItem = { success: false, error: error.message };
        }
    }

    async testCompleteSync() {
        this.logStep(7, 'RESUMEN DE FLUJO COMPLETO');

        console.log('📊 Simulación de sincronización completa:\n');

        const steps = [
            { name: 'Autenticación', status: this.results.steps.authentication?.success },
            { name: 'Listar Almacenes', status: this.results.steps.listWarehouses?.success },
            { name: 'Convertir Items', status: this.results.steps.itemConversion?.success },
            { name: 'Crear Items', status: this.results.steps.createItems?.success },
            { name: 'Listar Items', status: this.results.steps.listItems?.success },
            { name: 'Actualizar Items', status: this.results.steps.updateItem?.success }
        ];

        steps.forEach((step, idx) => {
            const icon = step.status === true ? '✅' : step.status === false ? '❌' : '⏭️';
            console.log(`   ${idx + 1}. ${icon} ${step.name}`);
        });

        console.log('\n📈 Estadísticas:');
        console.log(`   • Items creados: ${this.results.itemsCreated.length}`);
        console.log(`   • Errores totales: ${this.results.errors.length}`);
        console.log(`   • Pasos completados: ${steps.filter(s => s.status === true).length}/${steps.length}`);

        this.results.summary = {
            totalSteps: steps.length,
            completedSteps: steps.filter(s => s.status === true).length,
            itemsCreated: this.results.itemsCreated.length,
            errors: this.results.errors.length,
            readyForProduction: this.results.itemsCreated.length > 0 && this.results.errors.length === 0
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
            console.log(`\n💾 Resultados guardados en: logs/${filename}`);

        } catch (error) {
            console.error('⚠️  No se pudieron guardar los resultados:', error.message);
        }
    }

    printSummary() {
        if (this.results.summary) {
            const summary = this.results.summary;
            
            console.log('\n📊 RESUMEN FINAL DE PRUEBA');
            console.log('═'.repeat(70));
            console.log(`✅ Pasos completados: ${summary.completedSteps}/${summary.totalSteps}`);
            console.log(`✅ Items creados: ${summary.itemsCreated}`);
            console.log(`❌ Errores: ${summary.errors}`);
            console.log(`🚀 Listo para producción: ${summary.readyForProduction ? 'SÍ' : 'NO'}`);
            console.log('═'.repeat(70) + '\n');
        }
    }
}

// Ejecutar test
const test = new FracttalWorkflowTest();
test.run().catch(error => {
    console.error('Error fatal:', error);
    process.exit(1);
});
