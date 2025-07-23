const request = require('supertest');
const app = require('../src/server');

// Mock de los servicios
jest.mock('../src/services/sageService');
jest.mock('../src/services/fracttalClient');
jest.mock('../src/app', () => ({
  syncInventory: jest.fn()
}));

const { syncInventory } = require('../src/app');
const SageService = require('../src/services/sageService');
const FracttalClient = require('../src/services/fracttalClient');

describe('SageSync Server', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /', () => {
    it('should serve the dashboard HTML', async () => {
      const response = await request(app)
        .get('/')
        .expect(200);

      expect(response.text).toContain('SageSync Dashboard');
      expect(response.text).toContain('Sincronización de Inventario');
    });
  });

  describe('GET /api/status', () => {
    it('should return system status', async () => {
      // Mock de los servicios
      SageService.prototype.validateConnection = jest.fn().mockResolvedValue(true);
      FracttalClient.prototype.getAccessToken = jest.fn().mockResolvedValue('mock_token');

      const response = await request(app)
        .get('/api/status')
        .expect(200);

      expect(response.body).toHaveProperty('status', 'running');
      expect(response.body).toHaveProperty('sage');
      expect(response.body).toHaveProperty('fracttal');
      expect(response.body).toHaveProperty('sync');
      expect(response.body).toHaveProperty('uptime');
      expect(response.body).toHaveProperty('timestamp');
      
      expect(response.body.sage.connected).toBe(true);
      expect(response.body.fracttal.authenticated).toBe(true);
    });

    it('should handle service errors gracefully', async () => {
      // Mock de errores en servicios
      SageService.prototype.validateConnection = jest.fn().mockRejectedValue(new Error('DB Error'));
      FracttalClient.prototype.getAccessToken = jest.fn().mockRejectedValue(new Error('Auth Error'));

      const response = await request(app)
        .get('/api/status')
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/sage/stats', () => {
    it('should return Sage inventory statistics', async () => {
      const mockStats = {
        TotalItems: 100,
        TotalQuantity: 1000,
        AverageStandardCost: 150.00
      };

      const mockLocations = ['WH01', 'WH02', 'WH03'];

      SageService.prototype.getInventoryStats = jest.fn().mockResolvedValue(mockStats);
      SageService.prototype.getUniqueLocations = jest.fn().mockResolvedValue(mockLocations);

      const response = await request(app)
        .get('/api/sage/stats')
        .expect(200);

      expect(response.body).toEqual({
        ...mockStats,
        locations: 3,
        locationList: mockLocations
      });
    });

    it('should handle Sage service errors', async () => {
      SageService.prototype.getInventoryStats = jest.fn().mockRejectedValue(new Error('DB Error'));

      const response = await request(app)
        .get('/api/sage/stats')
        .expect(500);

      expect(response.body).toHaveProperty('error');
    });
  });

  describe('GET /api/sage/inventory', () => {
    it('should return all inventory items with pagination', async () => {
      const mockItems = Array.from({ length: 75 }, (_, i) => ({\n        ItemNumber: `ITEM${i.toString().padStart(3, '0')}`,\n        Description: `Test Item ${i}`,\n        Location: 'WH01',\n        QuantityOnHand: 10 + i\n      }));\n\n      SageService.prototype.getAllInventoryItems = jest.fn().mockResolvedValue(mockItems);\n\n      const response = await request(app)\n        .get('/api/sage/inventory')\n        .expect(200);\n\n      expect(response.body).toHaveProperty('items');\n      expect(response.body).toHaveProperty('total', 75);\n      expect(response.body).toHaveProperty('offset', 0);\n      expect(response.body).toHaveProperty('limit', 50);\n      expect(response.body).toHaveProperty('hasMore', true);\n      expect(response.body.items).toHaveLength(50);\n    });\n\n    it('should return items for specific location', async () => {\n      const mockItems = [\n        {\n          ItemNumber: 'ITEM001',\n          Description: 'Test Item 1',\n          Location: 'WH01',\n          QuantityOnHand: 10\n        }\n      ];\n\n      SageService.prototype.getInventoryItemsByLocation = jest.fn().mockResolvedValue(mockItems);\n\n      const response = await request(app)\n        .get('/api/sage/inventory/WH01')\n        .expect(200);\n\n      expect(response.body.items).toEqual(mockItems);\n      expect(response.body.total).toBe(1);\n    });\n\n    it('should handle pagination parameters', async () => {\n      const mockItems = Array.from({ length: 100 }, (_, i) => ({\n        ItemNumber: `ITEM${i.toString().padStart(3, '0')}`,\n        Description: `Test Item ${i}`\n      }));\n\n      SageService.prototype.getAllInventoryItems = jest.fn().mockResolvedValue(mockItems);\n\n      const response = await request(app)\n        .get('/api/sage/inventory?limit=25&offset=50')\n        .expect(200);\n\n      expect(response.body.limit).toBe(25);\n      expect(response.body.offset).toBe(50);\n      expect(response.body.items).toHaveLength(25);\n      expect(response.body.items[0]).toEqual(mockItems[50]);\n    });\n  });\n\n  describe('GET /api/fracttal/warehouses', () => {\n    it('should return Fracttal warehouses', async () => {\n      const mockWarehouses = {\n        data: [\n          { id: 1, name: 'Warehouse 1' },\n          { id: 2, name: 'Warehouse 2' }\n        ]\n      };\n\n      FracttalClient.prototype.getWarehouses = jest.fn().mockResolvedValue(mockWarehouses);\n\n      const response = await request(app)\n        .get('/api/fracttal/warehouses')\n        .expect(200);\n\n      expect(response.body).toEqual(mockWarehouses);\n    });\n\n    it('should handle Fracttal service errors', async () => {\n      FracttalClient.prototype.getWarehouses = jest.fn().mockRejectedValue(new Error('API Error'));\n\n      const response = await request(app)\n        .get('/api/fracttal/warehouses')\n        .expect(500);\n\n      expect(response.body).toHaveProperty('error');\n    });\n  });\n\n  describe('POST /api/sync', () => {\n    it('should start manual synchronization successfully', async () => {\n      syncInventory.mockResolvedValueOnce();\n\n      const response = await request(app)\n        .post('/api/sync')\n        .expect(200);\n\n      expect(response.body).toHaveProperty('success', true);\n      expect(response.body).toHaveProperty('message');\n      expect(response.body).toHaveProperty('timestamp');\n      expect(syncInventory).toHaveBeenCalled();\n    });\n\n    it('should handle synchronization errors', async () => {\n      const syncError = new Error('Sync failed');\n      syncInventory.mockRejectedValueOnce(syncError);\n\n      const response = await request(app)\n        .post('/api/sync')\n        .expect(500);\n\n      expect(response.body).toHaveProperty('success', false);\n      expect(response.body).toHaveProperty('error', 'Sync failed');\n      expect(response.body).toHaveProperty('timestamp');\n    });\n\n    it('should prevent concurrent synchronizations', async () => {\n      // Simular una sincronización en progreso\n      const longRunningSync = new Promise(resolve => {\n        setTimeout(() => resolve(), 1000);\n      });\n      syncInventory.mockReturnValueOnce(longRunningSync);\n\n      // Iniciar primera sincronización\n      const firstRequest = request(app).post('/api/sync');\n\n      // Intentar segunda sincronización inmediatamente\n      const secondResponse = await request(app)\n        .post('/api/sync')\n        .expect(409);\n\n      expect(secondResponse.body).toHaveProperty('error', 'Sincronización ya en progreso');\n\n      // Esperar a que termine la primera\n      await firstRequest.expect(200);\n    });\n  });\n\n  describe('GET /api/test/connections', () => {\n    it('should test both connections successfully', async () => {\n      SageService.prototype.validateConnection = jest.fn().mockResolvedValue(true);\n      FracttalClient.prototype.getAccessToken = jest.fn().mockResolvedValue('mock_token');\n\n      const response = await request(app)\n        .get('/api/test/connections')\n        .expect(200);\n\n      expect(response.body).toHaveProperty('sage');\n      expect(response.body).toHaveProperty('fracttal');\n      expect(response.body.sage.connected).toBe(true);\n      expect(response.body.sage.status).toBe('connected');\n      expect(response.body.fracttal.authenticated).toBe(true);\n      expect(response.body.fracttal.status).toBe('authenticated');\n    });\n\n    it('should handle connection failures', async () => {\n      SageService.prototype.validateConnection = jest.fn().mockResolvedValue(false);\n      FracttalClient.prototype.getAccessToken = jest.fn().mockRejectedValue(new Error('Auth failed'));\n\n      const response = await request(app)\n        .get('/api/test/connections')\n        .expect(200);\n\n      expect(response.body.sage.connected).toBe(false);\n      expect(response.body.sage.status).toBe('failed');\n      expect(response.body.fracttal.authenticated).toBe(false);\n      expect(response.body.fracttal.status).toBe('error');\n      expect(response.body.fracttal.error).toBe('Auth failed');\n    });\n  });\n\n  describe('Error handling', () => {\n    it('should handle 404 for non-existent routes', async () => {\n      const response = await request(app)\n        .get('/api/nonexistent')\n        .expect(404);\n    });\n  });\n});"}}]
