const fs = require('fs');
const path = require('path');
const os = require('os');

// Probamos ConfigManager con archivos temporales para no depender del config.json real.
describe('ConfigManager.getInventoryFilters', () => {
  let tmpDir;
  let originalConfigPath;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sagesync-cfg-'));
    originalConfigPath = path.join(__dirname, '../../config.json');
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    jest.resetModules();
  });

  // Carga ConfigManager con un config.json forzado a tmpDir.
  function loadConfigManagerWith(configContent) {
    const tmpConfigPath = path.join(tmpDir, 'config.json');
    fs.writeFileSync(tmpConfigPath, JSON.stringify(configContent, null, 2));

    jest.resetModules();
    jest.doMock('path', () => {
      const realPath = jest.requireActual('path');
      return {
        ...realPath,
        // Cuando ConfigManager hace path.join(__dirname, '../../config.json'),
        // lo redirigimos al archivo temporal.
        join: (...args) => {
          const joined = realPath.join(...args);
          if (joined.endsWith('config.json') && !joined.includes('package.json')) {
            return tmpConfigPath;
          }
          return joined;
        }
      };
    });
    const ConfigManager = require('../../src/config/configManager');
    return new ConfigManager();
  }

  it('returns configured filters when inventoryFilters is set', () => {
    const cm = loadConfigManagerWith({
      locationMapping: { GRAL: { fracttalWarehouseCode: 'X' } },
      defaultWarehouse: { code: 'X' },
      inventoryFilters: {
        itemBracketId: 'FSA',
        segment1Excluded: ['001', '002', '107']
      }
    });

    const f = cm.getInventoryFilters();
    expect(f.itemBracketId).toBe('FSA');
    expect(f.segment1Excluded).toEqual(['001', '002', '107']);
  });

  it('returns safe defaults (null itemBracketId, empty array) when inventoryFilters is missing', () => {
    const cm = loadConfigManagerWith({
      locationMapping: { GRAL: { fracttalWarehouseCode: 'X' } },
      defaultWarehouse: { code: 'X' }
    });
    const f = cm.getInventoryFilters();
    expect(f.itemBracketId).toBeNull();
    expect(f.segment1Excluded).toEqual([]);
  });

  it('trims string values and filters out empty/non-string segments', () => {
    const cm = loadConfigManagerWith({
      locationMapping: { GRAL: { fracttalWarehouseCode: 'X' } },
      defaultWarehouse: { code: 'X' },
      inventoryFilters: {
        itemBracketId: '  FSA  ',
        segment1Excluded: ['  001  ', '', '   ', 'X', 42, null, undefined]
      }
    });
    const f = cm.getInventoryFilters();
    expect(f.itemBracketId).toBe('FSA');
    expect(f.segment1Excluded).toEqual(['001', 'X']);
  });

  it('treats empty string itemBracketId as null (no filter applied)', () => {
    const cm = loadConfigManagerWith({
      locationMapping: { GRAL: { fracttalWarehouseCode: 'X' } },
      defaultWarehouse: { code: 'X' },
      inventoryFilters: {
        itemBracketId: '   ',
        segment1Excluded: []
      }
    });
    expect(cm.getInventoryFilters().itemBracketId).toBeNull();
  });

  it('handles non-array segment1Excluded by returning empty array', () => {
    const cm = loadConfigManagerWith({
      locationMapping: { GRAL: { fracttalWarehouseCode: 'X' } },
      defaultWarehouse: { code: 'X' },
      inventoryFilters: {
        itemBracketId: 'FSA',
        segment1Excluded: 'not-an-array'
      }
    });
    expect(cm.getInventoryFilters().segment1Excluded).toEqual([]);
  });
});
