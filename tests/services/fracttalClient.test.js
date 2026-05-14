const FracttalClient = require('../../src/services/fracttalClient');
const axios = require('axios');

// Mock de ConfigManager
jest.mock('../../src/config/configManager', () => {
  return jest.fn().mockImplementation(() => ({
    loadToken: jest.fn().mockReturnValue(null),
    saveToken: jest.fn().mockReturnValue(true),
    clearToken: jest.fn()
  }));
});

// Mock de logger
jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn()
}));

// Mock de axios
jest.mock('axios');
const mockedAxios = axios;

// Mock axios.create para devolver un objeto con los métodos necesarios
mockedAxios.create = jest.fn(() => ({
  interceptors: {
    request: {
      use: jest.fn()
    },
    response: {
      use: jest.fn()
    }
  },
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(),
  delete: jest.fn()
}));

describe('FracttalClient', () => {
  let fracttalClient;

  beforeEach(() => {
    fracttalClient = new FracttalClient();
    jest.clearAllMocks();
  });

  describe('authenticate', () => {
    it('should authenticate successfully with valid credentials', async () => {
      const mockResponse = {
        data: {
          access_token: 'mock_access_token',
          refresh_token: 'mock_refresh_token',
          expires_in: 7200,
          token_type: 'Bearer'
        }
      };

      mockedAxios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      const token = await fracttalClient.authenticate();

      expect(token).toBe('mock_access_token');
      expect(fracttalClient.accessToken).toBe('mock_access_token');
      expect(fracttalClient.refreshToken).toBe('mock_refresh_token');
      expect(mockedAxios.post).toHaveBeenCalledWith(
        'https://one.fracttal.com/oauth/token',
        'grant_type=client_credentials',
        {
          headers: {
            'Authorization': expect.stringContaining('Basic '),
            'Content-Type': 'application/x-www-form-urlencoded'
          }
        }
      );
    });

    it('should handle authentication errors', async () => {
      const mockError = new Error('Authentication failed');
      mockError.response = {
        status: 401,
        statusText: 'Unauthorized',
        data: { error: 'invalid_client' }
      };

      // Mock axios directamente para el método authenticate
      mockedAxios.post = jest.fn().mockRejectedValueOnce(mockError);

      await expect(fracttalClient.authenticate()).rejects.toThrow('Authentication failed');
    });
  });

  describe('refreshAccessToken', () => {
    beforeEach(() => {
      fracttalClient.refreshToken = 'mock_refresh_token';
    });

    it('should refresh token successfully', async () => {
      const mockResponse = {
        data: {
          access_token: 'new_access_token',
          refresh_token: 'new_refresh_token',
          expires_in: 7200
        }
      };

      mockedAxios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      const newToken = await fracttalClient.refreshAccessToken();

      expect(newToken).toBe('new_access_token');
      expect(fracttalClient.accessToken).toBe('new_access_token');
      expect(fracttalClient.refreshToken).toBe('new_refresh_token');
    });

    it('should throw error when no refresh token available', async () => {
      fracttalClient.refreshToken = null;

      await expect(fracttalClient.refreshAccessToken()).rejects.toThrow('No hay refresh token disponible');
    });
  });

  describe('getAccessToken', () => {
    it('should return existing valid token', async () => {
      fracttalClient.accessToken = 'existing_token';
      fracttalClient.tokenExpiry = new Date(Date.now() + 3600000); // 1 hora en el futuro

      const token = await fracttalClient.getAccessToken();

      expect(token).toBe('existing_token');
      expect(mockedAxios.post).not.toHaveBeenCalled();
    });

    it('should authenticate when no token exists', async () => {
      fracttalClient.accessToken = null;

      const mockResponse = {
        data: {
          access_token: 'new_token',
          expires_in: 7200
        }
      };

      mockedAxios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      const token = await fracttalClient.getAccessToken();

      expect(token).toBe('new_token');
      expect(mockedAxios.post).toHaveBeenCalled();
    });

    it('should authenticate when token is expired', async () => {
      fracttalClient.accessToken = 'expired_token';
      fracttalClient.tokenExpiry = new Date(Date.now() - 3600000); // 1 hora en el pasado

      const mockResponse = {
        data: {
          access_token: 'new_token',
          expires_in: 7200
        }
      };

      mockedAxios.post = jest.fn().mockResolvedValueOnce(mockResponse);

      const token = await fracttalClient.getAccessToken();

      expect(token).toBe('new_token');
      expect(mockedAxios.post).toHaveBeenCalled();
    });
  });

  describe('API methods', () => {
    beforeEach(() => {
      // Mock del client axios creado internamente
      fracttalClient.client = {
        get: jest.fn(),
        post: jest.fn(),
        put: jest.fn(),
        delete: jest.fn()
      };
      
      // Mock getAccessToken para que siempre devuelva un token
      fracttalClient.getAccessToken = jest.fn().mockResolvedValue('mock_token');
    });

    describe('getWarehouses', () => {
      it('should get warehouses successfully', async () => {
        const mockWarehouses = {
          data: [
            { id: 1, name: 'Warehouse 1' },
            { id: 2, name: 'Warehouse 2' }
          ]
        };

        fracttalClient.client.get.mockResolvedValueOnce({ data: mockWarehouses });

        const result = await fracttalClient.getWarehouses();

        expect(result).toEqual(mockWarehouses);
        expect(fracttalClient.client.get).toHaveBeenCalledWith('/warehouses');
      });

      it('should handle errors when getting warehouses', async () => {
        const mockError = new Error('Network error');
        fracttalClient.client.get.mockRejectedValueOnce(mockError);

        await expect(fracttalClient.getWarehouses()).rejects.toThrow('Network error');
      });
    });

    describe('createWarehouseItem', () => {
      it('should create warehouse item successfully', async () => {
        const itemData = {
          code: 'ITEM001',
          id_type_item: 4,
          field_1: 'Test Item',
          unit_code: 'UN',
          unit_description: 'Unidad'
        };

        const mockResponse = {
          data: { id: 1, ...itemData }
        };

        fracttalClient.client.post.mockResolvedValueOnce(mockResponse);

        const result = await fracttalClient.createWarehouseItem('warehouse1', itemData);

        expect(result).toEqual(mockResponse.data);
        expect(fracttalClient.client.post).toHaveBeenCalledWith('/items/', expect.objectContaining({
          code: 'ITEM001',
          id_type_item: 4,
          field_1: 'Test Item'
        }));
      });
    });

    describe('updateWarehouseItem', () => {
      it('should update warehouse item successfully', async () => {
        const itemData = {
          field_1: 'Updated Item',
          stock: 15
        };

        const mockResponse = {
          data: { id: 1, code: 'item1', ...itemData }
        };

        fracttalClient.client.put.mockResolvedValueOnce(mockResponse);

        const result = await fracttalClient.updateWarehouseItem('warehouse1', 'item1', itemData);

        expect(result).toEqual(mockResponse.data);
        // updateWarehouseItem es deprecated y delega a adjustInventoryStock,
        // que llama PUT /inventories_adjustment/{code} (no PUT /items/{code}).
        // Test corregido del item diferido en v1.1.
        expect(fracttalClient.client.put).toHaveBeenCalledWith('/inventories_adjustment/item1', expect.any(Object));
      });
    });

    describe('searchWarehouseItem', () => {
      it('should find item when it exists', async () => {
        const mockResponse = {
          data: {
            data: [{ id: 1, code: 'ITEM001', field_1: 'Test Item' }]
          }
        };

        fracttalClient.client.get.mockResolvedValueOnce(mockResponse);

        const result = await fracttalClient.searchWarehouseItem('warehouse1', 'ITEM001');

        expect(result).toEqual(mockResponse.data.data[0]);
        expect(fracttalClient.client.get).toHaveBeenCalledWith('/items', {
          params: { code: 'ITEM001', limit: 1 }
        });
      });

      it('should return null when item not found', async () => {
        const mockResponse = {
          data: { data: [] }
        };

        fracttalClient.client.get.mockResolvedValueOnce(mockResponse);

        const result = await fracttalClient.searchWarehouseItem('warehouse1', 'NONEXISTENT');

        expect(result).toBeNull();
      });

      it('should return null on error', async () => {
        fracttalClient.client.get.mockRejectedValueOnce(new Error('API Error'));

        const result = await fracttalClient.searchWarehouseItem('warehouse1', 'ITEM001');

        expect(result).toBeNull();
      });
    });
  });

  // Surfaced during sandbox validation pre-push: item "Capstone Gold" 404'd
  // because the space wasn't encoded. All path-segment methods now use
  // encodeURIComponent defensively.
  describe('URL encoding for path segments', () => {
    it('encodes spaces in item code for getInventoryByCode', async () => {
      fracttalClient.client.get.mockResolvedValueOnce({ data: { success: true, data: [] } });
      await fracttalClient.getInventoryByCode('Capstone Gold');
      expect(fracttalClient.client.get).toHaveBeenCalledWith('/items/Capstone%20Gold');
    });

    it('encodes spaces in item code for adjustInventoryStock', async () => {
      fracttalClient.client.put.mockResolvedValueOnce({ data: { success: true } });
      await fracttalClient.adjustInventoryStock('Capstone Gold', { code_warehouse: 'ALM-AMP', stock: 10 });
      expect(fracttalClient.client.put).toHaveBeenCalledWith('/inventories_adjustment/Capstone%20Gold', expect.any(Object));
    });

    it('encodes spaces in item code for getItemInventory', async () => {
      fracttalClient.client.get.mockResolvedValueOnce({ data: { success: true } });
      await fracttalClient.getItemInventory('Capstone Gold');
      expect(fracttalClient.client.get).toHaveBeenCalledWith('/inventories/Capstone%20Gold');
    });

    it('encodes spaces in item code for updateInventoryItem', async () => {
      fracttalClient.client.put.mockResolvedValueOnce({ data: { success: true } });
      await fracttalClient.updateInventoryItem('Capstone Gold', { id_type_item: 4 });
      expect(fracttalClient.client.put).toHaveBeenCalledWith('/items/Capstone%20Gold', expect.any(Object));
    });

    it('encodes slashes in warehouse code for getWarehouseByCode', async () => {
      fracttalClient.client.get.mockResolvedValueOnce({ data: { success: true, data: { code: 'A/B' } } });
      await fracttalClient.getWarehouseByCode('A/B');
      expect(fracttalClient.client.get).toHaveBeenCalledWith('/warehouses/A%2FB', { params: {} });
    });

    it('encodes warehouse code for createWarehouseEntry', async () => {
      fracttalClient.client.post.mockResolvedValueOnce({ data: { success: true } });
      await fracttalClient.createWarehouseEntry('WH ONE', {
        movement_type: 1,
        document: 'D1',
        code_user: 'u',
        items: []
      });
      expect(fracttalClient.client.post).toHaveBeenCalledWith('/warehouse_entries_orders/WH%20ONE', expect.any(Object));
    });

    it('leaves plain alphanumeric codes unchanged', async () => {
      fracttalClient.client.get.mockResolvedValueOnce({ data: { success: true, data: [] } });
      await fracttalClient.getInventoryByCode('ITEM001');
      expect(fracttalClient.client.get).toHaveBeenCalledWith('/items/ITEM001');
    });

    it('encodes unicode characters', async () => {
      fracttalClient.client.get.mockResolvedValueOnce({ data: { success: true, data: [] } });
      await fracttalClient.getInventoryByCode('REPUESTO-ÑU');
      // 'Ñ' → %C3%91; 'U' is plain ASCII
      expect(fracttalClient.client.get).toHaveBeenCalledWith('/items/REPUESTO-%C3%91U');
    });
  });
});
