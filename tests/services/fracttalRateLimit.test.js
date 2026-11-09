'use strict';

/**
 * Unit tests for the request pacing and the HTTP 429 retry in
 * src/services/fracttalClient.js. Fracttal allows 200 requests per minute per
 * company; above that it answers 429 "Too many requests (200) created from this
 * company ... please try again after 1 minute". The 2026-11-09 dry-run against
 * production skipped ~3,300 items because every 429 was treated as a failure.
 *
 * axios.create is mocked, so the interceptors the constructor registers are
 * called directly, and sleep is replaced so nothing waits for real.
 */

jest.mock('../../src/config/configManager', () => jest.fn().mockImplementation(() => ({
    loadToken: jest.fn().mockReturnValue(null),
    saveToken: jest.fn()
})));
jest.mock('axios');

const axios = require('axios');
const FracttalClient = require('../../src/services/fracttalClient');

axios.create = jest.fn(() => ({
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    request: jest.fn()
}));

const savedPerMinute = process.env.FRACTTAL_REQUESTS_PER_MINUTE;

afterEach(() => {
    jest.restoreAllMocks();
    if (savedPerMinute === undefined) delete process.env.FRACTTAL_REQUESTS_PER_MINUTE;
    else process.env.FRACTTAL_REQUESTS_PER_MINUTE = savedPerMinute;
});

function newClient() {
    const client = new FracttalClient();
    client.sleep = jest.fn().mockResolvedValue();
    client.getAccessToken = jest.fn().mockResolvedValue('token');
    const [onRequest] = client.client.interceptors.request.use.mock.calls[0];
    const [, onResponseError] = client.client.interceptors.response.use.mock.calls[0];
    return { client, onRequest, onResponseError };
}

function tooManyRequests(config, headers = {}) {
    return {
        config,
        message: 'Request failed with status code 429',
        response: {
            status: 429,
            headers,
            data: { message: 'Too many requests (200) created from this company (id_company=779), please try again after 1 minute' }
        }
    };
}

test('a 429 waits one minute and repeats the same request', async () => {
    const { client, onResponseError } = newClient();
    const config = { url: '/warehouses/SAGESYNC-PROD', method: 'get', headers: {} };
    client.client.request.mockResolvedValue({ data: { success: true } });

    await expect(onResponseError(tooManyRequests(config))).resolves.toEqual({ data: { success: true } });
    expect(client.sleep).toHaveBeenCalledWith(60000);
    expect(client.client.request).toHaveBeenCalledWith(config);
});

test('Retry-After from Fracttal sets the wait', async () => {
    const { client, onResponseError } = newClient();
    client.client.request.mockResolvedValue({ data: {} });

    await onResponseError(tooManyRequests({ url: '/inventories/X', headers: {} }, { 'retry-after': '7' }));

    expect(client.sleep).toHaveBeenCalledWith(7000);
});

test('after 5 retries the 429 reaches the caller', async () => {
    const { client, onResponseError } = newClient();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const error = tooManyRequests({ url: '/inventories/X', headers: {}, _retries429: 5 });

    await expect(onResponseError(error)).rejects.toBe(error);
    expect(client.sleep).not.toHaveBeenCalled();
    expect(client.client.request).not.toHaveBeenCalled();
});

test('requests are spaced to stay under FRACTTAL_REQUESTS_PER_MINUTE', async () => {
    process.env.FRACTTAL_REQUESTS_PER_MINUTE = '120';
    const { client, onRequest } = newClient();
    jest.spyOn(Date, 'now').mockReturnValue(1000000);

    const sent = [];
    for (let i = 0; i < 3; i++) {
        sent.push(await onRequest({ headers: {} }));
    }

    expect(client.sleep.mock.calls.map(([ms]) => ms)).toEqual([500, 1000]);
    expect(sent.every((config) => config.headers.Authorization === 'Bearer token')).toBe(true);
});

test('without FRACTTAL_REQUESTS_PER_MINUTE it allows 180 requests per minute', () => {
    delete process.env.FRACTTAL_REQUESTS_PER_MINUTE;
    const { client } = newClient();

    expect(client.requestIntervalMs).toBe(334);
});
