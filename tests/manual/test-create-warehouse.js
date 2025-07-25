const axios = require('axios');
require('dotenv').config();

async function testCreateWarehouse() {
    console.log('🔧 Probando creación de almacén en Fracttal...\n');
    
    const clientId = process.env.FRACTTAL_CLIENT_ID;
    const clientSecret = process.env.FRACTTAL_CLIENT_SECRET;
    const oauthURL = process.env.FRACTTAL_OAUTH_URL || 'https://one.fracttal.com/oauth/token';
    const baseURL = process.env.FRACTTAL_BASE_URL || 'https://app.fracttal.com/api';
    
    try {
        console.log('1️⃣ Obteniendo token de acceso...');
        
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        
        const authResponse = await axios.post(oauthURL, 'grant_type=client_credentials', {
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        const token = authResponse.data.access_token;
        console.log('✅ Token obtenido exitosamente');
        console.log('');
        
        console.log('2️⃣ Intentando crear almacén ALM-AMP...');
        
        // Datos del almacén según tu configuración
        const warehouseData = {
            code: "ALM-AMP",
            description: "ALMACEN AMP - Sincronizado desde Sage300",
            address: "Hacienda Nueva",
            state: "ZACATECAS",
            country: "México", 
            city: "MORELOS, ZACATECAS",
            external_integration: true,
            active: true,
            visible_to_all: true
        };
        
        console.log('📋 Datos del almacén:', JSON.stringify(warehouseData, null, 2));
        console.log('');
        
        try {
            const createResponse = await axios.post(`${baseURL}/warehouses/`, warehouseData, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000
            });
            
            console.log('✅ ¡Almacén creado exitosamente!');
            console.log(`   - Status: ${createResponse.status}`);
            console.log(`   - Respuesta:`, JSON.stringify(createResponse.data, null, 2));
            
        } catch (createError) {
            console.error('❌ Error creando almacén:', {
                status: createError.response?.status,
                statusText: createError.response?.statusText,
                data: createError.response?.data
            });
            
            // Si el almacén ya existe, intentemos consultar todos los almacenes
            if (createError.response?.status === 400 || createError.response?.status === 409) {
                console.log('');
                console.log('3️⃣ El almacén puede existir ya, intentando consultar...');
                
                try {
                    const listResponse = await axios.get(`${baseURL}/warehouses/`, {
                        headers: {
                            'Authorization': `Bearer ${token}`,
                            'Content-Type': 'application/json',
                            'Accept': 'application/json'
                        },
                        timeout: 30000
                    });
                    
                    console.log('✅ Consulta de almacenes exitosa');
                    console.log(`   - Status: ${listResponse.status}`);
                    if (listResponse.data.data && listResponse.data.data.length > 0) {
                        console.log('📦 Almacenes existentes:');
                        listResponse.data.data.forEach(wh => {
                            console.log(`   - ${wh.code}: ${wh.description}`);
                        });
                    } else {
                        console.log('📭 No hay almacenes en la cuenta');
                    }
                    
                } catch (listError) {
                    console.error('❌ Error consultando almacenes:', {
                        status: listError.response?.status,
                        data: listError.response?.data
                    });
                }
            }
        }
        
    } catch (error) {
        console.error('❌ Error general:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
    }
}

testCreateWarehouse();
