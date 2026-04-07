require('dotenv').config();

module.exports = {
    apiUrl: process.env.LICENSE_API_URL || '',
    hmacSecret: process.env.HMAC_SECRET || '',
    apiKey: process.env.SAGESYNC_API_KEY || '',
};
