const axios = require('axios');
require('dotenv').config();

async function discoverEndpoints() {
    console.log('🔧 Descubriendo endpoints disponibles en Fracttal...\n');
    
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
        
        // Lista de endpoints comunes para probar
        const endpoints = [
            '/companies',
            '/locations',
            '/assets',
            '/users/me',
            '/profile',
            '/companies/current',
            '/work_orders',
            '/parts',
            '/items',
            '/inventory_items',
            '/maintenance_requests',
            '/dashboard'
        ];
        
        console.log('2️⃣ Probando endpoints disponibles...');
        console.log('');
        
        for (const endpoint of endpoints) {
            try {
                const response = await axios.get(`${baseURL}${endpoint}`, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    timeout: 10000
                });
                
                console.log(`✅ ${endpoint} - Status: ${response.status} - Datos: ${response.data.data ? response.data.data.length : 'N/A'} items`);
                
            } catch (endpointError) {
                const status = endpointError.response?.status;
                const message = endpointError.response?.data?.message || endpointError.message;
                
                if (status === 401) {
                    console.log(`❌ ${endpoint} - 401 UNAUTHORIZED`);
                } else if (status === 403) {
                    console.log(`❌ ${endpoint} - 403 FORBIDDEN`);
                } else if (status === 404) {
                    console.log(`⚠️  ${endpoint} - 404 NOT FOUND`);
                } else {
                    console.log(`❌ ${endpoint} - ${status} ${message}`);
                }
            }
        }
        
        console.log('');
        console.log('3️⃣ Información del token JWT...');
        
        // Decodificar el token JWT para ver qué permisos tiene
        const tokenParts = token.split('.');
        if (tokenParts.length === 3) {
            try {
                const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
                console.log('🔍 Payload del token:');
                console.log(JSON.stringify(payload, null, 2));
            } catch (decodeError) {
                console.log('❌ No se pudo decodificar el token JWT');
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

discoverEndpoints();
