// Backend REST client: centralizes base URL + optional x-api-key header.
// The key lives in localStorage (entered on the Settings page) so the browser
// never hard-codes the server's AEGIS_API_KEY.

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const STORAGE_KEY = 'aegisApiKey';

export function getApiKey() {
    return localStorage.getItem(STORAGE_KEY) || '';
}

export function setApiKey(key) {
    if (key) localStorage.setItem(STORAGE_KEY, key);
    else localStorage.removeItem(STORAGE_KEY);
}

export async function apiFetch(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const key = getApiKey();
    if (key) headers['x-api-key'] = key;
    if (options.body && !headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
    }
    // E9 — session cookie rides along on cross-origin dev calls (5173 → 3001).
    return fetch(BASE_URL + path, { ...options, headers, credentials: 'include' });
}

// JSON fetch that treats non-2xx responses as errors — callers can no longer
// mistake a 4xx/5xx error body for a valid payload.
export async function fetchJson(path, options = {}) {
    const res = await apiFetch(path, options);
    if (!res.ok) {
        let message = `Request failed (${res.status})`;
        try {
            const body = await res.json();
            if (body?.error) message = String(body.error);
        } catch { /* non-JSON error body */ }
        const err = new Error(message);
        err.status = res.status;
        throw err;
    }
    return res.json();
}

export const API_URL = BASE_URL;
