'use strict';

/**
 * Unit tests for requireLicense middleware
 * Covers: ENF-01 (license enforcement gate)
 */

// ---- Mock LicenseValidator before requiring middleware ----
const mockIsValid = jest.fn();
const mockGetStatus = jest.fn();

jest.mock('../../src/services/LicenseValidator', () => ({
    isValid: mockIsValid,
    getStatus: mockGetStatus,
}));

const { requireLicense } = require('../../src/middleware/requireLicense');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeResMock() {
    const res = {
        status: jest.fn(),
        json: jest.fn(),
        setHeader: jest.fn(),
    };
    // Allow chaining: res.status(503).json(...)
    res.status.mockReturnValue(res);
    res.json.mockReturnValue(res);
    return res;
}

// ===========================================================================
// ENF-01: requireLicense returns 503 when license is invalid
// ===========================================================================
describe('requireLicense - ENF-01', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('calls next() when isValid() returns true', () => {
        mockIsValid.mockReturnValue(true);
        const req = {};
        const res = makeResMock();
        const next = jest.fn();

        requireLicense(req, res, next);

        expect(next).toHaveBeenCalledTimes(1);
        expect(res.status).not.toHaveBeenCalled();
    });

    test('returns 503 when isValid() returns false', () => {
        mockIsValid.mockReturnValue(false);
        mockGetStatus.mockReturnValue({ state: 'INVALID', active: false, expiresAt: null, lastChecked: null, lastSuccessfulCheck: null });
        const req = {};
        const res = makeResMock();
        const next = jest.fn();

        requireLicense(req, res, next);

        expect(res.status).toHaveBeenCalledWith(503);
        expect(next).not.toHaveBeenCalled();
    });

    test('503 response body contains error message "Licencia inactiva. Contacte a su proveedor."', () => {
        mockIsValid.mockReturnValue(false);
        mockGetStatus.mockReturnValue({ state: 'INVALID', active: false, expiresAt: null, lastChecked: null, lastSuccessfulCheck: null });
        const req = {};
        const res = makeResMock();
        const next = jest.fn();

        requireLicense(req, res, next);

        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                error: 'Licencia inactiva. Contacte a su proveedor.',
            })
        );
    });

    test('503 response body contains state field from getStatus()', () => {
        mockIsValid.mockReturnValue(false);
        mockGetStatus.mockReturnValue({ state: 'INVALID', active: false, expiresAt: null, lastChecked: null, lastSuccessfulCheck: null });
        const req = {};
        const res = makeResMock();
        const next = jest.fn();

        requireLicense(req, res, next);

        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                state: 'INVALID',
            })
        );
    });

    test('503 response body state reflects ERROR state from getStatus()', () => {
        mockIsValid.mockReturnValue(false);
        mockGetStatus.mockReturnValue({ state: 'ERROR', active: false, expiresAt: null, lastChecked: null, lastSuccessfulCheck: null });
        const req = {};
        const res = makeResMock();
        const next = jest.fn();

        requireLicense(req, res, next);

        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({
                state: 'ERROR',
            })
        );
    });

    test('response uses json (Content-Type application/json via res.json)', () => {
        mockIsValid.mockReturnValue(false);
        mockGetStatus.mockReturnValue({ state: 'INVALID', active: false, expiresAt: null, lastChecked: null, lastSuccessfulCheck: null });
        const req = {};
        const res = makeResMock();
        const next = jest.fn();

        requireLicense(req, res, next);

        // res.json() is called (Express sets Content-Type: application/json)
        expect(res.json).toHaveBeenCalledTimes(1);
    });

    test('does not call next() when isValid() returns false', () => {
        mockIsValid.mockReturnValue(false);
        mockGetStatus.mockReturnValue({ state: 'INVALID', active: false, expiresAt: null, lastChecked: null, lastSuccessfulCheck: null });
        const req = {};
        const res = makeResMock();
        const next = jest.fn();

        requireLicense(req, res, next);

        expect(next).not.toHaveBeenCalled();
    });
});
