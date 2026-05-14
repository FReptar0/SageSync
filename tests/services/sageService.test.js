const SageService = require('../../src/services/sageService');
const database = require('../../src/config/database');

// Helper para normalizar SQL (colapsa whitespace) y simplificar matching.
const norm = (sql) => sql.replace(/\s+/g, ' ').trim();

// Mock de ConfigManager — el test default deja inventoryFilters vacíos.
// Tests específicos de filtros sobrescriben getInventoryFilters por test.
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
    }),
    getInventoryFilters: jest.fn().mockReturnValue({
      itemBracketId: null,
      segment1Excluded: []
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

  describe('_buildInventoryQuery', () => {
    it('uses I.FMTITEMNO as ItemNumber source (not B.ITEMNO)', () => {
      const { query } = sageService._buildInventoryQuery({ applyFilters: false });
      expect(query).toMatch(/I\.FMTITEMNO\s+AS ItemNumber/);
      expect(query).not.toMatch(/B\.ITEMNO\s+AS ItemNumber/);
    });

    it('returns the canonical 8-column projection', () => {
      const { query } = sageService._buildInventoryQuery({ applyFilters: false });
      expect(query).toMatch(/AS ItemNumber/);
      expect(query).toMatch(/AS Description/);
      expect(query).toMatch(/AS Location/);
      expect(query).toMatch(/AS QuantityOnHand/);
      expect(query).toMatch(/AS MinimumStock/);
      expect(query).toMatch(/AS StandardCost/);
      expect(query).toMatch(/AS RecentCost/);
      expect(query).toMatch(/AS LastCost/);
    });

    it('always applies base filters (INACTIVE=0, STOCKITEM=1, LOCATION=GRAL)', () => {
      const { query } = sageService._buildInventoryQuery({ applyFilters: false });
      const normed = norm(query);
      expect(normed).toMatch(/I\.INACTIVE = 0/);
      expect(normed).toMatch(/I\.STOCKITEM = 1/);
      expect(normed).toMatch(/B\.LOCATION = 'GRAL'/);
    });

    it('does NOT include family filters when applyFilters=false', () => {
      sageService.configManager.getInventoryFilters.mockReturnValue({
        itemBracketId: 'FSA',
        segment1Excluded: ['001', '002']
      });
      const { query, parameters } = sageService._buildInventoryQuery({ applyFilters: false });
      expect(query).not.toMatch(/ITEMBRKID/);
      expect(query).not.toMatch(/SEGMENT1 NOT IN/);
      expect(parameters).toEqual({});
    });

    it('applies ITEMBRKID filter when applyFilters=true and config has itemBracketId', () => {
      sageService.configManager.getInventoryFilters.mockReturnValue({
        itemBracketId: 'FSA',
        segment1Excluded: []
      });
      const { query, parameters } = sageService._buildInventoryQuery({ applyFilters: true });
      expect(query).toMatch(/I\.ITEMBRKID = @itemBracketId/);
      expect(parameters.itemBracketId).toBe('FSA');
    });

    it('applies SEGMENT1 NOT IN filter with parameterized values', () => {
      sageService.configManager.getInventoryFilters.mockReturnValue({
        itemBracketId: 'FSA',
        segment1Excluded: ['001', '002', '107']
      });
      const { query, parameters } = sageService._buildInventoryQuery({ applyFilters: true });
      expect(query).toMatch(/I\.SEGMENT1 NOT IN \(@seg1Excl0, @seg1Excl1, @seg1Excl2\)/);
      expect(parameters.seg1Excl0).toBe('001');
      expect(parameters.seg1Excl1).toBe('002');
      expect(parameters.seg1Excl2).toBe('107');
    });

    it('does NOT use literal string interpolation for SEGMENT1 values (SQL injection guard)', () => {
      sageService.configManager.getInventoryFilters.mockReturnValue({
        itemBracketId: 'FSA',
        segment1Excluded: ["001", "'; DROP TABLE--"]
      });
      const { query } = sageService._buildInventoryQuery({ applyFilters: true });
      // El query NO debe contener los valores literales — solo placeholders.
      expect(query).not.toMatch(/DROP TABLE/);
      expect(query).not.toContain("'001'");
      expect(query).toMatch(/@seg1Excl0, @seg1Excl1/);
    });

    it('omits family filters when applyFilters=true but config is empty', () => {
      sageService.configManager.getInventoryFilters.mockReturnValue({
        itemBracketId: null,
        segment1Excluded: []
      });
      const { query, parameters } = sageService._buildInventoryQuery({ applyFilters: true });
      expect(query).not.toMatch(/ITEMBRKID/);
      expect(query).not.toMatch(/SEGMENT1/);
      expect(parameters).toEqual({});
    });

    it('appends extraWhere conditions with their parameters', () => {
      const { query, parameters } = sageService._buildInventoryQuery({
        applyFilters: false,
        extraWhere: [{ sql: 'I.FMTITEMNO = @itemNumber', name: 'itemNumber', value: 'AB-123' }]
      });
      expect(query).toMatch(/I\.FMTITEMNO = @itemNumber/);
      expect(parameters.itemNumber).toBe('AB-123');
    });

    it('keeps ORDER BY at the end (no broken composition like the old version)', () => {
      const { query } = sageService._buildInventoryQuery({
        applyFilters: false,
        extraWhere: [{ sql: 'B.LOCATION = @location', name: 'location', value: 'TEST' }]
      });
      const normed = norm(query);
      // ORDER BY debe aparecer DESPUÉS de todas las condiciones extra.
      const orderByIdx = normed.indexOf('ORDER BY');
      const extraConditionIdx = normed.indexOf('B.LOCATION = @location');
      expect(orderByIdx).toBeGreaterThan(extraConditionIdx);
    });
  });

  describe('getAllInventoryItems (sync path — applies filters)', () => {
    it('returns recordset and calls database.query with filtered query + parameters', async () => {
      sageService.configManager.getInventoryFilters.mockReturnValue({
        itemBracketId: 'FSA',
        segment1Excluded: ['001', '002']
      });
      const mockItems = [
        { ItemNumber: 'AB-100', Description: 'Test', Location: 'GRAL', QuantityOnHand: 10 }
      ];
      database.query.mockResolvedValueOnce({ recordset: mockItems });

      const result = await sageService.getAllInventoryItems();

      expect(result).toEqual(mockItems);
      expect(database.query).toHaveBeenCalledTimes(1);
      const [calledQuery, calledParams] = database.query.mock.calls[0];
      expect(calledQuery).toMatch(/I\.ITEMBRKID = @itemBracketId/);
      expect(calledQuery).toMatch(/I\.SEGMENT1 NOT IN \(@seg1Excl0, @seg1Excl1\)/);
      expect(calledQuery).toMatch(/I\.FMTITEMNO\s+AS ItemNumber/);
      expect(calledParams).toEqual({
        itemBracketId: 'FSA',
        seg1Excl0: '001',
        seg1Excl1: '002'
      });
    });

    it('skips family filters when config has no inventoryFilters', async () => {
      sageService.configManager.getInventoryFilters.mockReturnValue({
        itemBracketId: null,
        segment1Excluded: []
      });
      database.query.mockResolvedValueOnce({ recordset: [] });

      await sageService.getAllInventoryItems();

      const [calledQuery, calledParams] = database.query.mock.calls[0];
      expect(calledQuery).not.toMatch(/ITEMBRKID/);
      expect(calledQuery).not.toMatch(/SEGMENT1/);
      expect(calledParams).toEqual({});
    });

    it('handles database errors and rethrows', async () => {
      const mockError = new Error('Database connection failed');
      database.query.mockRejectedValueOnce(mockError);

      await expect(sageService.getAllInventoryItems()).rejects.toThrow('Database connection failed');
    });
  });

  describe('getInventoryItemsByLocation (dashboard path — no family filters)', () => {
    it('returns items and does NOT apply family filters even when config has them', async () => {
      sageService.configManager.getInventoryFilters.mockReturnValue({
        itemBracketId: 'FSA',
        segment1Excluded: ['001']
      });
      const mockItems = [{ ItemNumber: 'AB-100', Description: 'Test', Location: 'WH01' }];
      database.query.mockResolvedValueOnce({ recordset: mockItems });

      const result = await sageService.getInventoryItemsByLocation('WH01');

      expect(result).toEqual(mockItems);
      const [calledQuery, calledParams] = database.query.mock.calls[0];
      expect(calledQuery).not.toMatch(/ITEMBRKID/);
      expect(calledQuery).not.toMatch(/SEGMENT1/);
      expect(calledQuery).toMatch(/B\.LOCATION = @location/);
      expect(calledParams).toEqual({ location: 'WH01' });
    });
  });

  describe('getInventoryItemByCode (dashboard path — no family filters, looks up by FMTITEMNO)', () => {
    it('uses FMTITEMNO and no family filters', async () => {
      sageService.configManager.getInventoryFilters.mockReturnValue({
        itemBracketId: 'FSA',
        segment1Excluded: ['001']
      });
      const mockItem = { ItemNumber: 'AB-100', Description: 'X' };
      database.query.mockResolvedValueOnce({ recordset: [mockItem] });

      const result = await sageService.getInventoryItemByCode('AB-100');

      expect(result).toEqual(mockItem);
      const [calledQuery, calledParams] = database.query.mock.calls[0];
      expect(calledQuery).toMatch(/I\.FMTITEMNO = @itemNumber/);
      expect(calledQuery).not.toMatch(/ITEMBRKID/);
      expect(calledParams).toEqual({ itemNumber: 'AB-100' });
    });

    it('returns null when item not found', async () => {
      database.query.mockResolvedValueOnce({ recordset: [] });
      const result = await sageService.getInventoryItemByCode('NONEXISTENT');
      expect(result).toBeNull();
    });

    it('appends location filter when provided', async () => {
      database.query.mockResolvedValueOnce({ recordset: [] });
      await sageService.getInventoryItemByCode('AB-100', 'WH01');
      const [calledQuery, calledParams] = database.query.mock.calls[0];
      expect(calledQuery).toMatch(/I\.FMTITEMNO = @itemNumber/);
      expect(calledQuery).toMatch(/B\.LOCATION = @location/);
      expect(calledParams).toEqual({ itemNumber: 'AB-100', location: 'WH01' });
    });
  });

  describe('getUniqueLocations', () => {
    it('returns unique locations', async () => {
      const mockLocations = [
        { LOCATION: 'WH01' },
        { LOCATION: 'WH02' },
        { LOCATION: 'WH03' }
      ];
      database.query.mockResolvedValueOnce({ recordset: mockLocations });

      const result = await sageService.getUniqueLocations();

      expect(result).toEqual(['WH01', 'WH02', 'WH03']);
      expect(database.query).toHaveBeenCalledWith(
        expect.stringContaining('SELECT DISTINCT B.LOCATION')
      );
    });
  });

  describe('getInventoryStats', () => {
    it('returns inventory statistics', async () => {
      const mockStats = {
        TotalItems: 100,
        TotalLocations: 5,
        TotalQuantity: 1000,
        AverageLastCost: 150.0
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
    it('transforms a Sage item to Fracttal format', () => {
      const sageItem = {
        ItemNumber: 'ITEM001',
        Description: 'Test Item',
        Location: 'WH01',
        QuantityOnHand: 10,
        MinimumStock: 5,
        StandardCost: 100.0,
        RecentCost: 110.0,
        LastCost: 95.0
      };

      const result = sageService.transformToFracttalFormat(sageItem);

      expect(result).toEqual({
        code: 'ITEM001',
        name: 'Test Item',
        description: 'Test Item',
        location: 'WH01',
        quantity: 10,
        minimum_stock: 5,
        cost: 95.0,
        unit_of_measure: 'UN',
        category: 'Inventory',
        sync_source: 'Sage300',
        sync_date: expect.any(String)
      });
    });

    it('handles null/undefined values gracefully', () => {
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
        cost: 0,
        unit_of_measure: 'UN',
        category: 'Inventory',
        sync_source: 'Sage300',
        sync_date: expect.any(String)
      });
    });

    it('trims whitespace from strings', () => {
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
    it('returns true when connection is valid', async () => {
      database.testConnection.mockResolvedValueOnce(true);
      const result = await sageService.validateConnection();
      expect(result).toBe(true);
      expect(database.testConnection).toHaveBeenCalled();
    });

    it('returns false when connection fails', async () => {
      database.testConnection.mockResolvedValueOnce(false);
      const result = await sageService.validateConnection();
      expect(result).toBe(false);
    });

    it('returns false when connection throws error', async () => {
      database.testConnection.mockRejectedValueOnce(new Error('Connection error'));
      const result = await sageService.validateConnection();
      expect(result).toBe(false);
    });
  });
});
