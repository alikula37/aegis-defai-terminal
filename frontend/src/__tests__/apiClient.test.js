import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getApiKey, setApiKey, apiFetch } from '../lib/apiClient';

describe('apiClient', () => {
    beforeEach(() => {
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('stores and clears the API key in localStorage', () => {
        expect(getApiKey()).toBe('');
        setApiKey('secret-123');
        expect(getApiKey()).toBe('secret-123');
        setApiKey('');
        expect(getApiKey()).toBe('');
    });

    it('attaches x-api-key header when a key is set', async () => {
        setApiKey('rest-secret');
        const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        await apiFetch('/api/settings');
        const [url, options] = fetchMock.mock.calls[0];
        expect(String(url)).toMatch(/\/api\/settings$/);
        expect(options.headers['x-api-key']).toBe('rest-secret');
    });

    it('omits x-api-key header when no key is set', async () => {
        const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        await apiFetch('/api/settings');
        const [, options] = fetchMock.mock.calls[0];
        expect(options.headers['x-api-key']).toBeUndefined();
    });

    it('adds Content-Type only when a body is present', async () => {
        const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        await apiFetch('/api/settings');
        expect(fetchMock.mock.calls[0][1].headers['Content-Type']).toBeUndefined();

        await apiFetch('/api/simulation/start', { method: 'POST', body: JSON.stringify({ a: 1 }) });
        expect(fetchMock.mock.calls[1][1].headers['Content-Type']).toBe('application/json');
    });

    it('sends credentials so the session cookie rides along (E9)', async () => {
        const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        await apiFetch('/api/auth/me');
        expect(fetchMock.mock.calls[0][1].credentials).toBe('include');
    });
});
