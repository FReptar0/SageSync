'use strict';

/**
 * Integration tests for syncInventory({ dryRun: true }).
 *
 * Critical invariant: in dry-run, NO write methods on FracttalClient are called.
 * Critical invariant: the summary classifies items into Case A/B/C correctly.
 *
 * Mocks SageService + FracttalClient + ConfigManager + LicenseValidator at module load
 * BEFORE requiring src/app, because src/app constructs service instances synchronously.
 */

// ---- Block validateEnv so requiring src/app doesn't exit ----
jest.mock('../../src/utils/validateEnv', () => ({
    validateEnv: jest.fn()
}));

// ---- Block node-cron so we don't schedule real cron jobs in tests ----
jest.mock('node-cron', () => ({
    schedule: jest.fn()
}));

// ---- LicenseValidator: always valid ----
jest.mock('../../src/services/LicenseValidator', () => ({
    validate: jest.fn().mockResolvedValue({ state: 'VALID', valid: true }),
    isValid: jest.fn().mockReturnValue(true),
    getStatus: jest.fn().mockReturnValue({ state: 'VALID' })
}));

// ---- SageService (single shared mock instance so app.js wires correctly) ----
const mockSage = {
    validateConnection: jest.fn(),
    getAllInventoryItems: jest.fn(),
    mapSageLocationToFracttalWarehouse: jest.fn()
};
jest.mock('../../src/services/sageService', () => {
    return jest.fn().mockImplementation(() => mockSage);
});

// ---- FracttalClient (single shared mock instance) ----
const mockFracttal = {
    getAccessToken: jest.fn(),
    getWarehouseByCode: jest.fn(),
    ensureWarehouseExists: jest.fn(),
    checkItemExistsInWarehouse: jest.fn(),
    createInventoryWithWarehouse: jest.fn(),
    associateItemToWarehouse: jest.fn(),
    adjustInventoryStock: jest.fn(),
    createWarehouse: jest.fn()
};
jest.mock('../../src/services/fracttalClient', () => {
    return jest.fn().mockImplementation(() => mockFracttal);
});

// ---- ConfigManager (validateConfig passes, no filters) ----
jest.mock('../../src/config/configManager', () => {
    return jest.fn().mockImplementation(() => ({
        validateConfig: jest.fn().mockReturnValue(true),
        getInventoryFilters: jest.fn().mockReturnValue({ itemBracketId: null, segment1Excluded: [] }),
        getLocationMapping: jest.fn().mockReturnValue({ fracttalWarehouseCode: 'ALM-AMP', specialRules: [] })
    }));
});

// Now require app
const { syncInventory } = require('../../src/app');

// Helpers para escenarios
const itemAlpha = { ItemNumber: 'AB-001', Description: 'Item Alpha', Location: 'GRAL', QuantityOnHand: 50, MinimumStock: 10, LastCost: 100 };
const itemBravo = { ItemNumber: 'AB-002', Description: 'Item Bravo', Location: 'GRAL', QuantityOnHand: 75, MinimumStock: 5, LastCost: 200 };
const itemCharlie = { ItemNumber: 'AB-003', Description: 'Item Charlie', Location: 'GRAL', QuantityOnHand: 0, MinimumStock: 1, LastCost: 50 };

function mockCheckItemExistsByCode(map) {
    // map: { 'AB-001': { exists, inWarehouse, warehouseData? } }
    mockFracttal.checkItemExistsInWarehouse.mockImplementation((itemCode) => {
        const r = map[itemCode];
        if (!r) return Promise.resolve({ exists: false, inWarehouse: false, itemData: null });
        return Promise.resolve(r);
    });
}

describe('syncInventory dry-run mode', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSage.validateConnection.mockResolvedValue(true);
        mockSage.mapSageLocationToFracttalWarehouse.mockReturnValue('ALM-AMP');
        mockFracttal.getAccessToken.mockResolvedValue('mock-token');
        mockFracttal.getWarehouseByCode.mockResolvedValue({ success: true, data: { code: 'ALM-AMP' } });
    });

    test('does NOT call any Fracttal write methods', async () => {
        mockSage.getAllInventoryItems.mockResolvedValue([itemAlpha, itemBravo, itemCharlie]);
        mockCheckItemExistsByCode({
            'AB-001': { exists: true, inWarehouse: true, warehouseData: { stock: 42 } },
            'AB-002': { exists: true, inWarehouse: false },
            'AB-003': { exists: false, inWarehouse: false }
        });

        await syncInventory({ dryRun: true });

        // Cero escrituras
        expect(mockFracttal.createInventoryWithWarehouse).not.toHaveBeenCalled();
        expect(mockFracttal.associateItemToWarehouse).not.toHaveBeenCalled();
        expect(mockFracttal.adjustInventoryStock).not.toHaveBeenCalled();
        expect(mockFracttal.ensureWarehouseExists).not.toHaveBeenCalled();
        expect(mockFracttal.createWarehouse).not.toHaveBeenCalled();
        // En dry-run usamos getWarehouseByCode (read-only) en lugar de ensureWarehouseExists
        expect(mockFracttal.getWarehouseByCode).toHaveBeenCalledWith('ALM-AMP');
    });

    test('classifies items into Case A/B/C and reports caseCounts in the summary', async () => {
        mockSage.getAllInventoryItems.mockResolvedValue([itemAlpha, itemBravo, itemCharlie]);
        mockCheckItemExistsByCode({
            'AB-001': { exists: true, inWarehouse: true, warehouseData: { stock: 42 } }, // Case A
            'AB-002': { exists: true, inWarehouse: false },                                // Case B
            'AB-003': { exists: false, inWarehouse: false }                                 // Case C
        });

        const summary = await syncInventory({ dryRun: true });

        expect(summary.dryRun).toBe(true);
        expect(summary.totalItems).toBe(3);
        expect(summary.processedItems).toBe(3);
        expect(summary.errors).toBe(0);
        expect(summary.caseCounts).toEqual({ caseA: 1, caseB: 1, caseC: 1 });
        expect(summary.updatedItems).toBe(1); // Case A
        expect(summary.createdItems).toBe(2); // Case B + Case C
    });

    test('preview entries include itemCode, case label, current/planned stock, and warehouse', async () => {
        mockSage.getAllInventoryItems.mockResolvedValue([itemAlpha]);
        mockCheckItemExistsByCode({
            'AB-001': { exists: true, inWarehouse: true, warehouseData: { stock: 999 } }
        });

        const summary = await syncInventory({ dryRun: true });

        expect(summary.preview).toHaveLength(1);
        expect(summary.preview[0]).toMatchObject({
            itemCode: 'AB-001',
            fracttalWarehouse: 'ALM-AMP',
            case: 'A',
            currentStockInWarehouse: 999,
            plannedStock: 50,
            plannedUnitCost: 100,
            plannedMin: 10
        });
    });

    test('reports warehousesMissing when getWarehouseByCode returns 404 in dry-run', async () => {
        const notFoundErr = new Error('Not found');
        notFoundErr.response = { status: 404 };
        mockFracttal.getWarehouseByCode.mockRejectedValueOnce(notFoundErr);

        mockSage.getAllInventoryItems.mockResolvedValue([itemAlpha]);
        mockCheckItemExistsByCode({
            'AB-001': { exists: false, inWarehouse: false }
        });

        const summary = await syncInventory({ dryRun: true });

        expect(summary.warehousesMissing).toContain('ALM-AMP');
        // Item still classified as Case C, no creation actually attempted
        expect(summary.caseCounts.caseC).toBe(1);
        expect(mockFracttal.createWarehouse).not.toHaveBeenCalled();
    });

    test('aborts cleanly when sage.validateConnection returns false', async () => {
        mockSage.validateConnection.mockResolvedValue(false);

        const summary = await syncInventory({ dryRun: true });

        expect(summary).toBeUndefined();
        expect(mockSage.getAllInventoryItems).not.toHaveBeenCalled();
        expect(mockFracttal.adjustInventoryStock).not.toHaveBeenCalled();
    });

    test('counts per-item errors but continues processing rest', async () => {
        mockSage.getAllInventoryItems.mockResolvedValue([itemAlpha, itemBravo]);
        mockFracttal.checkItemExistsInWarehouse
            .mockRejectedValueOnce(new Error('boom on AB-001'))
            .mockResolvedValueOnce({ exists: false, inWarehouse: false });

        const summary = await syncInventory({ dryRun: true });

        expect(summary.errors).toBe(1);
        expect(summary.processedItems).toBe(1); // sólo AB-002 procesado
        expect(summary.caseCounts.caseC).toBe(1);
    });
});

describe('syncInventory non-dry-run (regression — writes still occur)', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockSage.validateConnection.mockResolvedValue(true);
        mockSage.mapSageLocationToFracttalWarehouse.mockReturnValue('ALM-AMP');
        mockFracttal.getAccessToken.mockResolvedValue('mock-token');
        mockFracttal.ensureWarehouseExists.mockResolvedValue({ code: 'ALM-AMP' });
        mockFracttal.createInventoryWithWarehouse.mockResolvedValue({ success: true });
        mockFracttal.associateItemToWarehouse.mockResolvedValue({ success: true });
        mockFracttal.adjustInventoryStock.mockResolvedValue({ success: true });
    });

    test('calls adjustInventoryStock for Case A (default mode = no dryRun)', async () => {
        mockSage.getAllInventoryItems.mockResolvedValue([itemAlpha]);
        mockCheckItemExistsByCode({
            'AB-001': { exists: true, inWarehouse: true, warehouseData: { stock: 5 } }
        });

        await syncInventory();

        expect(mockFracttal.ensureWarehouseExists).toHaveBeenCalledWith('ALM-AMP');
        expect(mockFracttal.adjustInventoryStock).toHaveBeenCalledTimes(1);
        expect(mockFracttal.adjustInventoryStock).toHaveBeenCalledWith('AB-001', expect.objectContaining({
            code_warehouse: 'ALM-AMP',
            stock: 50
        }));
        expect(mockFracttal.createInventoryWithWarehouse).not.toHaveBeenCalled();
        expect(mockFracttal.associateItemToWarehouse).not.toHaveBeenCalled();
    });

    test('calls associateItemToWarehouse + adjustInventoryStock for Case B', async () => {
        mockSage.getAllInventoryItems.mockResolvedValue([itemBravo]);
        mockCheckItemExistsByCode({
            'AB-002': { exists: true, inWarehouse: false }
        });

        await syncInventory();

        expect(mockFracttal.associateItemToWarehouse).toHaveBeenCalledTimes(1);
        expect(mockFracttal.adjustInventoryStock).toHaveBeenCalledTimes(1);
        expect(mockFracttal.createInventoryWithWarehouse).not.toHaveBeenCalled();
    });

    test('calls createInventoryWithWarehouse + adjustInventoryStock for Case C', async () => {
        mockSage.getAllInventoryItems.mockResolvedValue([itemCharlie]);
        mockCheckItemExistsByCode({
            'AB-003': { exists: false, inWarehouse: false }
        });

        await syncInventory();

        expect(mockFracttal.createInventoryWithWarehouse).toHaveBeenCalledTimes(1);
        expect(mockFracttal.adjustInventoryStock).toHaveBeenCalledTimes(1);
        expect(mockFracttal.associateItemToWarehouse).not.toHaveBeenCalled();
    });
});
