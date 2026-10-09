// configManager.js llama a dotenv al cargarse; un .env local con CONFIG_PATH
// no debe volver inestables estas pruebas.
jest.mock('dotenv', () => ({ config: jest.fn() }));

const fs = require('fs');
const path = require('path');
const os = require('os');

// tests/setup.js ya cargó el .env real antes de este archivo, así que CONFIG_PATH
// puede venir definido: cada prueba arranca sin él y al final se restaura, igual que el cwd.
let savedConfigPath;
let originalCwd;

beforeEach(() => {
  savedConfigPath = process.env.CONFIG_PATH;
  delete process.env.CONFIG_PATH;
  originalCwd = process.cwd();
});

afterEach(() => {
  if (savedConfigPath === undefined) {
    delete process.env.CONFIG_PATH;
  } else {
    process.env.CONFIG_PATH = savedConfigPath;
  }
  process.chdir(originalCwd);
});

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

// CONFIG_PATH elige el archivo de mapeo de cada servidor (por ejemplo config.local.json).
describe('ConfigManager CONFIG_PATH', () => {
  const PROJECT_ROOT = path.resolve(__dirname, '../..');
  const REPO_CONFIG = path.join(PROJECT_ROOT, 'config.json');
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sagesync-cfgpath-'));
  });

  afterEach(() => {
    // Primero el cwd y luego el borrado: Windows no puede borrar el directorio de trabajo
    // actual, y estas pruebas también viajan en el dist para QA en el servidor.
    process.chdir(originalCwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // Escribe un config mínimo en tmpDir y devuelve su ruta absoluta.
  function writeFixture(fileName, code) {
    const filePath = path.join(tmpDir, fileName);
    fs.writeFileSync(filePath, JSON.stringify({
      locationMapping: { GRAL: { fracttalWarehouseCode: code } },
      defaultWarehouse: { code }
    }, null, 2));
    return filePath;
  }

  // Registro de módulos limpio: devuelve el logger y el dotenv (mocks) que va a usar
  // ConfigManager. beforeRequire puede configurarlos antes de cargar configManager.js.
  function freshLoad(beforeRequire) {
    jest.resetModules();
    // El jest.doMock('path') de loadConfigManagerWith sobrevive a resetModules y mandaría
    // cualquier path.join que termine en config.json a un archivo temporal ya borrado.
    jest.dontMock('path');
    const logger = require('../../src/config/logger');
    const dotenv = require('dotenv');
    if (beforeRequire) {
      beforeRequire({ logger, dotenv });
    }
    const ConfigManager = require('../../src/config/configManager');
    return { ConfigManager, logger, dotenv };
  }

  function readRepoConfig() {
    return JSON.parse(fs.readFileSync(REPO_CONFIG, 'utf8'));
  }

  it('unset: loads the repo config.json', () => {
    const { ConfigManager, logger } = freshLoad();
    const cm = new ConfigManager();

    expect(cm.configPath).toBe(REPO_CONFIG);
    expect(cm.config).toEqual(readRepoConfig());
    expect(logger.info).toHaveBeenCalledWith(`Configuración cargada exitosamente desde ${REPO_CONFIG}`);
  });

  it('blank: whitespace-only CONFIG_PATH behaves as unset', () => {
    process.env.CONFIG_PATH = '   ';
    const { ConfigManager } = freshLoad();
    const cm = new ConfigManager();

    expect(cm.configPath).toBe(REPO_CONFIG);
  });

  it('absolute: loads that file', () => {
    const abs = writeFixture('config.local.json', 'TMP-ABS');
    process.env.CONFIG_PATH = abs;
    const { ConfigManager, logger } = freshLoad();
    const cm = new ConfigManager();

    expect(cm.configPath).toBe(abs);
    expect(cm.getDefaultWarehouse().code).toBe('TMP-ABS');
    expect(logger.info).toHaveBeenCalledWith(`Configuración cargada exitosamente desde ${abs}`);
  });

  it('relative: a relative path to another file is honored', () => {
    const abs = writeFixture('config.local.json', 'TMP-REL');
    process.env.CONFIG_PATH = path.relative(PROJECT_ROOT, abs);
    const { ConfigManager } = freshLoad();
    const cm = new ConfigManager();

    expect(cm.configPath).toBe(abs);
    expect(cm.getDefaultWarehouse().code).toBe('TMP-REL');
  });

  it('relative: resolved against the project root, not the cwd', () => {
    // Señuelo: un config.json en el cwd que NO debe cargarse.
    writeFixture('config.json', 'DECOY-CWD');
    process.env.CONFIG_PATH = 'config.json';
    process.chdir(tmpDir);
    const { ConfigManager } = freshLoad();
    const cm = new ConfigManager();

    expect(cm.configPath).toBe(REPO_CONFIG);
    expect(cm.getDefaultWarehouse().code).not.toBe('DECOY-CWD');
    expect(cm.config).toEqual(readRepoConfig());
  });

  it('missing file: throws naming CONFIG_PATH and the path; never falls back to config.json', () => {
    const missing = path.join(tmpDir, 'no-existe.json');
    process.env.CONFIG_PATH = missing;
    const { ConfigManager, logger } = freshLoad();

    let thrown;
    try {
      new ConfigManager();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(Error);
    expect(thrown.message).toContain('CONFIG_PATH');
    expect(thrown.message).toContain(missing);
    const loadedMessages = logger.info.mock.calls
      .map(([message]) => message)
      .filter((message) => typeof message === 'string' && message.includes('Configuración cargada exitosamente'));
    expect(loadedMessages).toEqual([]);
  });

  it('saveConfig writes to the CONFIG_PATH file, not the repo config.json', () => {
    const abs = writeFixture('config.local.json', 'TMP-SAVE');
    process.env.CONFIG_PATH = abs;
    const repoBefore = fs.readFileSync(REPO_CONFIG);
    const { ConfigManager } = freshLoad();
    const cm = new ConfigManager();

    try {
      // Si el archivo activo no es el de CONFIG_PATH, la prueba se detiene aquí, antes de escribir.
      expect(cm.configPath).toBe(abs);
      cm.updateLocationMapping('NUEVA', 'ALM-NUEVA');

      const saved = JSON.parse(fs.readFileSync(abs, 'utf8'));
      expect(saved.locationMapping.NUEVA.fracttalWarehouseCode).toBe('ALM-NUEVA');
      expect(fs.readFileSync(REPO_CONFIG).equals(repoBefore)).toBe(true);
    } finally {
      // Red de seguridad: si una implementación rota escribió en el config.json del repo, se restaura.
      if (!fs.readFileSync(REPO_CONFIG).equals(repoBefore)) {
        fs.writeFileSync(REPO_CONFIG, repoBefore);
      }
    }
  });

  it('dotenv.config() runs before CONFIG_PATH is read (a .env value is honored)', () => {
    const abs = writeFixture('config.local.json', 'TMP-DOTENV');
    // CONFIG_PATH sigue borrada: solo la define el mock de dotenv, como lo haría un .env.
    const { ConfigManager, dotenv } = freshLoad(({ dotenv: dotenvMock }) => {
      dotenvMock.config.mockImplementation(() => {
        process.env.CONFIG_PATH = abs;
        return { parsed: {} };
      });
    });
    const cm = new ConfigManager();

    expect(dotenv.config).toHaveBeenCalled();
    expect(cm.configPath).toBe(abs);
  });
});
