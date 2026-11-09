'use strict';

/**
 * Unit tests for the Fracttal token renewal in src/services/fracttalClient.js.
 * A token lasts 2 h and the initial load about 3 h, so it is renewed mid-load:
 * - after a 401 the token saved in .fracttal-token is discarded, because
 *   reloading it retried every item with the token Fracttal had just rejected;
 * - a saved token that expires within 5 minutes is replaced, not reused.
 *
 * axios is mocked: axios.post answers the OAuth call and the interceptors the
 * constructor registers are called directly.
 */

jest.mock('../../src/config/configManager', () => jest.fn().mockImplementation(() => ({
    loadToken: jest.fn().mockReturnValue(null),
    saveToken: jest.fn(),
    clearToken: jest.fn()
})));
jest.mock('axios');

const axios = require('axios');
const FracttalClient = require('../../src/services/fracttalClient');

axios.create = jest.fn(() => ({
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
    request: jest.fn()
}));

const MINUTE = 60 * 1000;

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    axios.post = jest.fn().mockResolvedValue({ data: { access_token: 'fresh', expires_in: 7200 } });
});

afterEach(() => {
    jest.restoreAllMocks();
});

function savedToken(accessToken, minutesLeft) {
    return {
        access_token: accessToken,
        refresh_token: null,
        expires_at: new Date(Date.now() + minutesLeft * MINUTE).toISOString()
    };
}

test('a 401 discards the saved token and retries with a new one', async () => {
    const client = new FracttalClient();
    let saved = savedToken('rejected', 60);
    client.configManager.loadToken.mockImplementation(() => saved);
    client.configManager.clearToken.mockImplementation(() => { saved = null; });
    client.client.request.mockResolvedValue({ data: 'ok' });
    const [, onResponseError] = client.client.interceptors.response.use.mock.calls[0];
    const config = { url: '/inventories/X', headers: { Authorization: 'Bearer rejected' } };

    const result = await onResponseError({ config, response: { status: 401, data: { message: 'Unauthorized' } } });

    expect(result).toEqual({ data: 'ok' });
    expect(client.configManager.clearToken).toHaveBeenCalled();
    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(client.client.request).toHaveBeenCalledWith(expect.objectContaining({
        headers: { Authorization: 'Bearer fresh' }
    }));
});

test('a saved token that expires within 5 minutes is replaced', async () => {
    const client = new FracttalClient();
    client.configManager.loadToken.mockReturnValue(savedToken('about-to-expire', 2));

    await expect(client.authenticate()).resolves.toBe('fresh');
    expect(axios.post).toHaveBeenCalledTimes(1);
});

test('a saved token with more time left is reused', async () => {
    const client = new FracttalClient();
    client.configManager.loadToken.mockReturnValue(savedToken('saved', 30));

    await expect(client.authenticate()).resolves.toBe('saved');
    expect(axios.post).not.toHaveBeenCalled();
});
