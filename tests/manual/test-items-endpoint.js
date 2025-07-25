const axios = require('axios');
require('dotenv').config();

async function testItemsEndpoint() {
    console.log('🔧 Probando endpoint /items en Fracttal...\n');
    
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
        
        console.log('2️⃣ Consultando items existentes...');
        
        try {
            const itemsResponse = await axios.get(`${baseURL}/items`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000
            });
            
            console.log('✅ Consulta de items exitosa');
            console.log(`   - Status: ${itemsResponse.status}`);
            console.log('   - Estructura de respuesta:', JSON.stringify(itemsResponse.data, null, 2));
            
            if (itemsResponse.data.data && itemsResponse.data.data.length > 0) {
                console.log('');
                console.log('📦 Items existentes:');
                itemsResponse.data.data.slice(0, 5).forEach(item => {
                    console.log(`   - ${item.code || item.id}: ${item.description || item.name || 'Sin descripción'}`);
                });
                if (itemsResponse.data.data.length > 5) {
                    console.log(`   ... y ${itemsResponse.data.data.length - 5} más`);
                }
            } else {
                console.log('📭 No hay items en la cuenta');
            }
            
        } catch (itemsError) {
            console.error('❌ Error consultando items:', {
                status: itemsError.response?.status,
                data: itemsError.response?.data
            });
        }
        
        console.log('');
        console.log('3️⃣ Probando creación de item de prueba...');
        
        const testItem = {
            code: "TEST-SAGE-001",
            description: "Item de prueba desde SageSync",
            category: "Herramientas",
            manufacturer: "Sage300",
            model: "TEST",
            active: true
        };
        
        try {
            const createResponse = await axios.post(`${baseURL}/items`, testItem, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000
            });
            
            console.log('✅ ¡Item creado exitosamente!');
            console.log(`   - Status: ${createResponse.status}`);
            console.log('   - Respuesta:', JSON.stringify(createResponse.data, null, 2));
            
        } catch (createError) {
            console.error('❌ Error creando item:', {
                status: createError.response?.status,
                statusText: createError.response?.statusText,
                data: createError.response?.data
            });
        }
        
    } catch (error) {
        console.error('❌ Error general:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
    }
}

testItemsEndpoint();
