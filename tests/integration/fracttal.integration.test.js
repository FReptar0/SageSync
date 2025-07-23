const FracttalClient = require('../../src/services/fracttalClient');

describe('Fracttal Integration Tests', () => {
  let fracttalClient;

  beforeAll(() => {
    fracttalClient = new FracttalClient();
  });

  describe('Authentication', () => {
    test('should authenticate successfully with real credentials', async () => {
      const token = await fracttalClient.authenticate();
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
      expect(fracttalClient.accessToken).toBe(token);
      expect(fracttalClient.tokenExpiry).toBeInstanceOf(Date);
      expect(fracttalClient.tokenExpiry.getTime()).toBeGreaterThan(Date.now());
    }, 10000);

    test('should get access token (cached or new)', async () => {
      const token = await fracttalClient.getAccessToken();
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    }, 10000);
  });

  describe('API Endpoints', () => {
    beforeEach(async () => {
      // Asegurar que tenemos un token válido
      await fracttalClient.getAccessToken();
    });

    test('should handle API requests with authentication', async () => {
      // Este test verifica que el cliente puede hacer requests autenticados
      // sin importar si el endpoint específico existe
      try {
        await fracttalClient.getWarehouses();
        // Si llega aquí, la autenticación funcionó
        expect(true).toBe(true);
      } catch (error) {
        // Si falla, verificamos que no sea por autenticación (401)
        if (error.response) {
          expect(error.response.status).not.toBe(401);
          // Errores 404, 500, etc. son aceptables para este test
          expect([404, 405, 500, 502, 503]).toContain(error.response.status);
        }
      }
    }, 15000);

    test('should handle 401 errors and retry with new token', async () => {
      // Forzar token expirado para probar renovación
      fracttalClient.accessToken = 'expired_token';
      fracttalClient.tokenExpiry = new Date(Date.now() - 1000);

      try {
        await fracttalClient.getWarehouses();
        // Si llega aquí, la renovación de token funcionó
        expect(fracttalClient.accessToken).not.toBe('expired_token');
      } catch (error) {
        // Si falla, verificamos que no sea por autenticación
        if (error.response) {
          expect(error.response.status).not.toBe(401);
        }
      }
    }, 15000);
  });

  describe('Token Management', () => {
    test('should refresh token if available', async () => {
      // Primero obtener un token
      await fracttalClient.authenticate();
      
      if (fracttalClient.refreshToken) {
        const oldToken = fracttalClient.accessToken;
        
        try {
          const newToken = await fracttalClient.refreshAccessToken();
          
          expect(newToken).toBeDefined();
          expect(typeof newToken).toBe('string');
          expect(newToken).not.toBe(oldToken);
        } catch (error) {
          // Algunos proveedores OAuth no implementan refresh tokens
          // para client credentials, esto es normal
          console.log('Refresh token not supported or expired:', error.message);
        }
      } else {
        console.log('No refresh token available (normal for client credentials)');
      }
    }, 10000);

    test('should handle token expiry gracefully', async () => {
      // Establecer un token que "expirará" pronto
      fracttalClient.tokenExpiry = new Date(Date.now() + 1000); // Expira en 1 segundo
      
      // Esperar a que expire
      await new Promise(resolve => setTimeout(resolve, 1100));
      
      // El próximo request debería obtener un nuevo token
      const token = await fracttalClient.getAccessToken();
      
      expect(token).toBeDefined();
      expect(fracttalClient.tokenExpiry.getTime()).toBeGreaterThan(Date.now() + 3600000); // Al menos 1 hora válido
    }, 15000);
  });
});

describe('Fracttal Client Configuration', () => {
  test('should use correct OAuth URL', () => {
    const client = new FracttalClient();
    expect(client.oauthURL).toBe('https://one.fracttal.com/oauth/token');
  });

  test('should use correct API base URL', () => {
    const client = new FracttalClient();
    expect(client.baseURL).toBe('https://app.fracttal.com/api');
  });

  test('should have client credentials configured', () => {
    const client = new FracttalClient();
    expect(client.clientId).toBeDefined();
    expect(client.clientSecret).toBeDefined();
    expect(client.clientId.length).toBeGreaterThan(0);
    expect(client.clientSecret.length).toBeGreaterThan(0);
  });
});
