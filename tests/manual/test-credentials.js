const axios = require('axios');
require('dotenv').config();

async function testCredentials() {
    console.log('🔧 Verificando credenciales de Fracttal...\n');
    
    const clientId = process.env.FRACTTAL_CLIENT_ID;
    const clientSecret = process.env.FRACTTAL_CLIENT_SECRET;
    const oauthURL = process.env.FRACTTAL_OAUTH_URL || 'https://one.fracttal.com/oauth/token';
    const baseURL = process.env.FRACTTAL_BASE_URL || 'https://app.fracttal.com/api';
    
    console.log('🔑 Configuración:');
    console.log(`   - OAuth URL: ${oauthURL}`);
    console.log(`   - Base URL: ${baseURL}`);
    console.log(`   - Client ID: ${clientId ? `${clientId.substring(0, 10)}...` : 'NO CONFIGURADO'}`);
    console.log(`   - Client Secret: ${clientSecret ? 'CONFIGURADO' : 'NO CONFIGURADO'}`);
    console.log('');
    
    if (!clientId || !clientSecret) {
        console.error('❌ Las credenciales no están configuradas correctamente');
        return;
    }
    
    try {
        console.log('1️⃣ Probando autenticación OAuth2...');
        
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
        
        const response = await axios.post(oauthURL, 'grant_type=client_credentials', {
            headers: {
                'Authorization': `Basic ${credentials}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });
        
        console.log('✅ Autenticación exitosa');
        console.log(`   - Token type: ${response.data.token_type}`);
        console.log(`   - Expires in: ${response.data.expires_in} segundos`);
        console.log(`   - Access token: ${response.data.access_token.substring(0, 50)}...`);
        console.log('');
        
        // Probar endpoints básicos
        const token = response.data.access_token;
        
        console.log('2️⃣ Probando endpoint básico /warehouses...');
        try {
            const warehousesResponse = await axios.get(`${baseURL}/warehouses`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000
            });
            
            console.log('✅ Endpoint /warehouses accesible');
            console.log(`   - Status: ${warehousesResponse.status}`);
            console.log(`   - Almacenes: ${warehousesResponse.data.data ? warehousesResponse.data.data.length : 0}`);
            
        } catch (endpointError) {
            console.error('❌ Error accediendo a /warehouses:', {
                status: endpointError.response?.status,
                statusText: endpointError.response?.statusText,
                data: endpointError.response?.data
            });
        }
        
        console.log('');
        console.log('3️⃣ Probando endpoint /inventories...');
        try {
            const inventoriesResponse = await axios.get(`${baseURL}/inventories`, {
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 30000
            });
            
            console.log('✅ Endpoint /inventories accesible');
            console.log(`   - Status: ${inventoriesResponse.status}`);
            console.log(`   - Inventarios: ${inventoriesResponse.data.data ? inventoriesResponse.data.data.length : 0}`);
            
        } catch (endpointError) {
            console.error('❌ Error accediendo a /inventories:', {
                status: endpointError.response?.status,
                statusText: endpointError.response?.statusText,
                data: endpointError.response?.data
            });
        }
        
    } catch (error) {
        console.error('❌ Error en autenticación:', {
            message: error.message,
            status: error.response?.status,
            data: error.response?.data
        });
    }
}

testCredentials();
