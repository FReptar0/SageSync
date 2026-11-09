'use strict';

/**
 * Unit tests for the item loop of the full load (syncInventory) and the daily
 * load (syncInventoryMoved) in src/app.js:
 * - the warehouse is checked once per run, not once per item, because Fracttal
 *   limits requests per minute;
 * - an item skipped because the warehouse check failed counts as an error (the
 *   2026-11-09 dry-run reported "Errores: 4" while ~3,300 items were skipped);
 * - new items are created with unit PZA / PIEZA.
 *
 * Sage, Fracttal, the config and the license are mocked.
 */

jest.mock('../../src/utils/validateEnv', () => ({ validateEnv: jest.fn() }));
jest.mock('../../src/services/LicenseValidator', () => ({
    validate: jest.fn(),
    isValid: jest.fn(() => true)
}));
jest.mock('../../src/services/sageService');
jest.mock('../../src/services/fracttalClient');
jest.mock('../../src/config/configManager');

const SageService = require('../../src/services/sageService');
const FracttalClient = require('../../src/services/fracttalClient');
const { syncInventory, syncInventoryMoved } = require('../../src/app');

const sage = SageService.mock.instances[0];
const fracttal = FracttalClient.mock.instances[0];

function sageItem(code) {
    return {
        ItemNumber: code,
        Location: 'GRAL',
        Description: `Item ${code}`,
        QuantityOnHand: '5',
        LastCost: '10',
        MinimumStock: '1'
    };
}

beforeEach(() => {
    jest.clearAllMocks();
    const items = [sageItem('A-1'), sageItem('A-2'), sageItem('A-3')];
    sage.validateConnection.mockResolvedValue(true);
    sage.getAllInventoryItems.mockResolvedValue(items);
    sage.getMovedInventoryItems.mockResolvedValue(items);
    sage.mapSageLocationToFracttalWarehouse.mockReturnValue('SAGESYNC-PROD');
    fracttal.getAccessToken.mockResolvedValue('token');
    fracttal.getWarehouseByCode.mockResolvedValue({ success: true, data: { code: 'SAGESYNC-PROD' } });
    fracttal.ensureWarehouseExists.mockResolvedValue({ code: 'SAGESYNC-PROD' });
    fracttal.checkItemExistsInWarehouse.mockResolvedValue({ exists: false, inWarehouse: false, itemData: null });
    fracttal.createInventoryWithWarehouse.mockResolvedValue({});
    fracttal.adjustInventoryStock.mockResolvedValue({});
});

describe.each([
    ['full load', syncInventory],
    ['daily load', syncInventoryMoved]
])('%s', (name, sync) => {
    test('a dry-run checks the warehouse once for the whole run', async () => {
        const summary = await sync({ dryRun: true });

        expect(fracttal.getWarehouseByCode).toHaveBeenCalledTimes(1);
        expect(summary.processedItems).toBe(3);
        expect(summary.errors).toBe(0);
    });

    test('an item skipped by a failed warehouse check counts as an error', async () => {
        fracttal.getWarehouseByCode.mockRejectedValue(
            Object.assign(new Error('Request failed with status code 429'), { response: { status: 429 } })
        );

        const summary = await sync({ dryRun: true });

        expect(summary.processedItems).toBe(0);
        expect(summary.errors).toBe(3);
    });

    test('a real run ensures the warehouse once and creates new items with unit PZA', async () => {
        const summary = await sync({ dryRun: false });

        expect(fracttal.ensureWarehouseExists).toHaveBeenCalledTimes(1);
        expect(fracttal.createInventoryWithWarehouse).toHaveBeenCalledTimes(3);
        expect(fracttal.createInventoryWithWarehouse).toHaveBeenCalledWith(expect.objectContaining({
            code_warehouse: 'SAGESYNC-PROD',
            unit_code: 'PZA',
            unit_description: 'PIEZA'
        }));
        expect(summary.errors).toBe(0);
    });
});
