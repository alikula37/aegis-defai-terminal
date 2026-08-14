// B4 — production fail-closed auth for REST writes and WebSocket handshake.
import { describe, it, expect, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { apiKeyMiddleware } from '../utils/apiAuth.js';
import { expectedWsKey, validateWsSubprotocol } from '../utils/wsAuth.js';

function buildApp() {
    const app = express();
    app.use('/api/', apiKeyMiddleware);
    app.get('/api/ping', (req, res) => res.json({ ok: true }));
    app.post('/api/ping', (req, res) => res.json({ ok: true }));
    return app;
}

describe('B4 — production auth fail-closed', () => {
    const prevEnv = process.env.NODE_ENV;
    const prevKey = process.env.AEGIS_API_KEY;

    afterEach(() => {
        if (prevEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevEnv;
        if (prevKey === undefined) delete process.env.AEGIS_API_KEY;
        else process.env.AEGIS_API_KEY = prevKey;
    });

    it('rejects write endpoints in production when no API key is configured', async () => {
        process.env.NODE_ENV = 'production';
        delete process.env.AEGIS_API_KEY;
        const app = buildApp();
        expect((await request(app).post('/api/ping')).status).toBe(401);
        expect((await request(app).get('/api/ping')).status).toBe(200);
    });

    it('enforces the API key when configured (dev and prod)', async () => {
        process.env.NODE_ENV = 'production';
        process.env.AEGIS_API_KEY = 'secret-key';
        const app = buildApp();
        expect((await request(app).post('/api/ping')).status).toBe(401);
        const ok = await request(app).post('/api/ping').set('x-api-key', 'secret-key');
        expect(ok.status).toBe(200);
    });

    it('stays open for writes in development without a key', async () => {
        process.env.NODE_ENV = 'development';
        delete process.env.AEGIS_API_KEY;
        const app = buildApp();
        expect((await request(app).post('/api/ping')).status).toBe(200);
    });

    it('WS handshake is rejected in production without a configured WS_API_KEY', () => {
        process.env.NODE_ENV = 'production';
        delete process.env.WS_API_KEY;
        expect(expectedWsKey()).toBeNull();
        expect(validateWsSubprotocol(['aegis-default-ws-key'], null, true)).toBe(false);
    });

    it('WS handshake accepts the configured key in production', () => {
        process.env.NODE_ENV = 'production';
        process.env.WS_API_KEY = 'ws-real-key';
        expect(validateWsSubprotocol(['ws-real-key'], 'ws-real-key', true)).toBe('ws-real-key');
        expect(validateWsSubprotocol(['aegis-default-ws-key'], 'ws-real-key', true)).toBe(false);
    });
});
