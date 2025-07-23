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
          name: 'Test Item',
          quantity: 10
        };

        const mockResponse = {
          data: { id: 1, ...itemData }
        };

        fracttalClient.client.post.mockResolvedValueOnce(mockResponse);

        const result = await fracttalClient.createWarehouseItem('warehouse1', itemData);

        expect(result).toEqual(mockResponse.data);
        expect(fracttalClient.client.post).toHaveBeenCalledWith('/warehouses/warehouse1/items', itemData);
      });
    });

    describe('updateWarehouseItem', () => {
      it('should update warehouse item successfully', async () => {
        const itemData = {
          name: 'Updated Item',
          quantity: 15
        };

        const mockResponse = {
          data: { id: 1, ...itemData }
        };

        fracttalClient.client.put.mockResolvedValueOnce(mockResponse);

        const result = await fracttalClient.updateWarehouseItem('warehouse1', 'item1', itemData);

        expect(result).toEqual(mockResponse.data);
        expect(fracttalClient.client.put).toHaveBeenCalledWith('/warehouses/warehouse1/items/item1', itemData);
      });
    });

    describe('searchWarehouseItem', () => {
      it('should find item when it exists', async () => {
        const mockResponse = {
          data: {
            data: [{ id: 1, code: 'ITEM001', name: 'Test Item' }]
          }
        };

        fracttalClient.client.get.mockResolvedValueOnce(mockResponse);

        const result = await fracttalClient.searchWarehouseItem('warehouse1', 'ITEM001');

        expect(result).toEqual(mockResponse.data.data[0]);
        expect(fracttalClient.client.get).toHaveBeenCalledWith('/warehouses/warehouse1/items', {
          params: { search: 'ITEM001', limit: 1 }
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
});
