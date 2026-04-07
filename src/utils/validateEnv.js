require('dotenv').config();

const REQUIRED_VARS = {
    license: ['LICENSE_API_URL', 'HMAC_SECRET', 'SAGESYNC_API_KEY'],
    database: ['DB_HOST', 'DB_USER', 'DB_PASSWORD', 'DB_NAME'],
    fracttal: ['FRACTTAL_CLIENT_ID', 'FRACTTAL_CLIENT_SECRET'],
};

/**
 * Validate all required environment variables are set.
 * Checks all groups and reports ALL missing vars before exiting.
 * Exits with code 1 if any required variables are missing.
 */
function validateEnv() {
    const missing = [];

    for (const [group, vars] of Object.entries(REQUIRED_VARS)) {
        for (const varName of vars) {
            if (!process.env[varName]) {
                missing.push({ varName, group });
            }
        }
    }

    if (missing.length > 0) {
        console.error('[ENV ERROR] Missing required environment variables:');
        for (const { varName, group } of missing) {
            console.error('  - ' + varName + ' (' + group + ')');
        }
        console.error('Add them to .env and restart.');
        process.exit(1);
    }
}

module.exports = { validateEnv };
