/**
 * License Enforcement Middleware
 *
 * Blocks all requests with HTTP 503 when the cached license state is not VALID.
 * Applied globally in main.js BEFORE express.static so that both API routes
 * and static HTML serving are gated.
 *
 * The exemption path (/api/system/license) is handled by the wrapper in main.js,
 * not inside this middleware, so this function is a clean single-responsibility gate.
 *
 * Uses LicenseValidator.isValid() -- synchronous, no HTTP call.
 * Uses LicenseValidator.getStatus() -- synchronous, returns cached state.
 */

const { isValid, getStatus } = require('../services/LicenseValidator');

/**
 * Express middleware that requires a valid license.
 *
 * - If license is valid: calls next()
 * - If license is invalid: returns 503 with JSON error body including state
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
function requireLicense(req, res, next) {
    if (!isValid()) {
        const status = getStatus();
        return res.status(503).json({
            error: 'Licencia inactiva. Contacte a su proveedor.',
            state: status.state,
        });
    }
    next();
}

module.exports = { requireLicense };
