const SageService = require('../../src/services/sageService');
const database = require('../../src/config/database');

// Mock de ConfigManager
jest.mock('../../src/config/configManager', () => {
  return jest.fn().mockImplementation(() => ({
    getLocationMapping: jest.fn().mockReturnValue({
      fracttalWarehouseCode: 'ALM-AMP',
      specialRules: []
    }),
    getAllLocationMappings: jest.fn().mockReturnValue({
      'GRAL': { fracttalWarehouseCode: 'ALM-AMP' }
    }),
    getDefaultWarehouse: jest.fn().mockReturnValue({
      code: 'ALM-AMP',
      name: 'Almacén Principal'
    }),
    getSyncSettings: jest.fn().mockReturnValue({
      batchSize: 100
    })
  }));
});

// Mock de la base de datos
jest.mock('../../src/config/database');

describe('SageService', () => {
  let sageService;

  beforeEach(() => {
    sageService = new SageService();
    jest.clearAllMocks();
  });

  describe('getAllInventoryItems', () => {
    it('should return all inventory items', async () => {
      const mockItems = [
        {
          ItemNumber: 'ITEM001',
          Description: 'Test Item 1',
          Location: 'WH01',
          QuantityOnHand: 10,
          MinimumStock: 5,
          StandardCost: 100.00
        },
        {
          ItemNumber: 'ITEM002',
          Description: 'Test Item 2',
          Location: 'WH01',
          QuantityOnHand: 20,
          MinimumStock: 10,
          StandardCost: 200.00
        }
      ];

      database.query.mockResolvedValueOnce({ recordset: mockItems });

      const result = await sageService.getAllInventoryItems();

      expect(result).toEqual(mockItems);
      expect(database.query).toHaveBeenCalledWith(sageService.inventoryQuery);
    });

    it('should handle database errors', async () => {
      const mockError = new Error('Database connection failed');
      database.query.mockRejectedValueOnce(mockError);

      await expect(sageService.getAllInventoryItems()).rejects.toThrow('Database connection failed');
    });
  });

  describe('getInventoryItemsByLocation', () => {
    it('should return items for specific location', async () => {
      const mockItems = [
        {
          ItemNumber: 'ITEM001',
          Description: 'Test Item 1',
          Location: 'WH01',
          QuantityOnHand: 10
        }
      ];

      database.query.mockResolvedValueOnce({ recordset: mockItems });

      const result = await sageService.getInventoryItemsByLocation('WH01');

      expect(result).toEqual(mockItems);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('AND L.LOCATION = @location'),
        { location: 'WH01' }
      );
    });
  });

  describe('getInventoryItemByCode', () => {
    it('should return specific item by code', async () => {
      const mockItem = {
        ItemNumber: 'ITEM001',
        Description: 'Test Item 1',
        Location: 'WH01',
        QuantityOnHand: 10
      };

      database.query.mockResolvedValueOnce({ recordset: [mockItem] });

      const result = await sageService.getInventoryItemByCode('ITEM001');

      expect(result).toEqual(mockItem);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('AND L.ITEMNO = @itemNumber'),
        { itemNumber: 'ITEM001' }
      );
    });

    it('should return null when item not found', async () => {
      database.query.mockResolvedValueOnce({ recordset: [] });

      const result = await sageService.getInventoryItemByCode('NONEXISTENT');

      expect(result).toBeNull();
    });

    it('should include location filter when provided', async () => {
      const mockItem = {
        ItemNumber: 'ITEM001',
        Description: 'Test Item 1',
        Location: 'WH01',
        QuantityOnHand: 10
      };

      database.query.mockResolvedValueOnce({ recordset: [mockItem] });

      const result = await sageService.getInventoryItemByCode('ITEM001', 'WH01');

      expect(result).toEqual(mockItem);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('AND L.LOCATION = @location'),
        { itemNumber: 'ITEM001', location: 'WH01' }
      );
    });
  });

  describe('getUniqueLocations', () => {
    it('should return unique locations', async () => {
      const mockLocations = [
        { LOCATION: 'WH01' },
        { LOCATION: 'WH02' },
        { LOCATION: 'WH03' }
      ];

      database.query.mockResolvedValueOnce({ recordset: mockLocations });

      const result = await sageService.getUniqueLocations();

      expect(result).toEqual(['WH01', 'WH02', 'WH03']);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT DISTINCT L.LOCATION')
      );
    });
  });

  describe('getInventoryStats', () => {
    it('should return inventory statistics', async () => {
      const mockStats = {
        TotalItems: 100,
        TotalLocations: 5,
        TotalQuantity: 1000,
        AverageLastCost: 150.00
      };

      database.query.mockResolvedValueOnce({ recordset: [mockStats] });

      const result = await sageService.getInventoryStats();

      expect(result).toEqual(mockStats);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('COUNT(*) as TotalItems')
      );
    });
  });

  describe('transformToFracttalFormat', () => {
    it('should transform Sage item to Fracttal format', () => {
      const sageItem = {
        ItemNumber: 'ITEM001',
        Description: 'Test Item',
        Location: 'WH01',
        QuantityOnHand: 10,
        MinimumStock: 5,
        StandardCost: 100.00,
        RecentCost: 110.00,
        LastCost: 95.00
      };

      const result = sageService.transformToFracttalFormat(sageItem);

      expect(result).toEqual({
        code: 'ITEM001',
        name: 'Test Item',
        description: 'Test Item',
        location: 'WH01',
        quantity: 10,
        minimum_stock: 5,
        standard_cost: 100.00,
        recent_cost: 110.00,
        last_cost: 95.00,
        unit_of_measure: 'UN',
        category: 'Inventory',
        sync_source: 'Sage300',
        sync_date: expect.any(String)
      });
    });

    it('should handle null/undefined values gracefully', () => {
      const sageItem = {
        ItemNumber: 'ITEM001',
        Description: null,
        Location: '  WH01  ',
        QuantityOnHand: null,
        MinimumStock: undefined,
        StandardCost: 'invalid'
      };

      const result = sageService.transformToFracttalFormat(sageItem);

      expect(result).toEqual({
        code: 'ITEM001',
        name: 'ITEM001',
        description: undefined,
        location: 'WH01',
        quantity: 0,
        minimum_stock: 0,
        standard_cost: 0,
        recent_cost: 0,
        last_cost: 0,
        unit_of_measure: 'UN',
        category: 'Inventory',
        sync_source: 'Sage300',
        sync_date: expect.any(String)
      });
    });

    it('should trim whitespace from strings', () => {
      const sageItem = {
        ItemNumber: '  ITEM001  ',
        Description: '  Test Item  ',
        Location: '  WH01  '
      };

      const result = sageService.transformToFracttalFormat(sageItem);

      expect(result.code).toBe('ITEM001');
      expect(result.name).toBe('Test Item');
      expect(result.description).toBe('Test Item');
      expect(result.location).toBe('WH01');
    });
  });

  describe('validateConnection', () => {
    it('should return true when connection is valid', async () => {
      database.testConnection.mockResolvedValueOnce(true);

      const result = await sageService.validateConnection();

      expect(result).toBe(true);
      expect(database.testConnection).toHaveBeenCalled();
    });

    it('should return false when connection fails', async () => {
      database.testConnection.mockResolvedValueOnce(false);

      const result = await sageService.validateConnection();

      expect(result).toBe(false);
    });

    it('should return false when connection throws error', async () => {
      database.testConnection.mockRejectedValueOnce(new Error('Connection error'));

      const result = await sageService.validateConnection();

      expect(result).toBe(false);
    });
  });
});
