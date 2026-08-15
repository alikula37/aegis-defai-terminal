// B6 — rate-limit guard behavior, tested in isolation so the shared test app's
// global limiters can't be tripped by the assertions.
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter, createFailureLimiter } from '../utils/rateLimit.js';

describe('Rate limiting (B6)', () => {
    function buildApp(max) {
        const app = express();
        app.use('/api/', createRateLimiter({ max }));
        app.get('/api/ping', (req, res) => res.json({ ok: true }));
        app.post('/api/ping', (req, res) => res.json({ ok: true }));
        return app;
    }

    it('rejects requests over the limit with 429', async () => {
        const app = buildApp(2);
        expect((await request(app).get('/api/ping')).status).toBe(200);
        expect((await request(app).get('/api/ping')).status).toBe(200);
        const third = await request(app).get('/api/ping');
        expect(third.status).toBe(429);
    });

    it('lets a burst under the limit through', async () => {
        const app = buildApp(5);
        const statuses = await Promise.all(
            [1, 2, 3].map(() => request(app).get('/api/ping').then(r => r.status)),
        );
        expect(statuses).toEqual([200, 200, 200]);
    });

    it('failure limiter: failures count, a success clears the bucket', async () => {
        const app = express();
        app.use('/api/auth/', createFailureLimiter({ max: 5 }));
        app.post('/api/auth/login', (req, res) => res.status(401).json({ error: 'bad creds' }));
        app.post('/api/auth/ok', (req, res) => res.json({ ok: true }));
        // Failures accumulate…
        expect((await request(app).post('/api/auth/login')).status).toBe(401);
        expect((await request(app).post('/api/auth/login')).status).toBe(401);
        // …but a success while the bucket is NOT full goes through and clears it.
        expect((await request(app).post('/api/auth/ok')).status).toBe(200);
        // Failures are counted again from zero after the reset.
        for (let i = 0; i < 5; i++) {
            expect((await request(app).post('/api/auth/login')).status).toBe(401);
        }
        expect((await request(app).post('/api/auth/login')).status).toBe(429);
    });

    it('without a success reset, the full bucket blocks everyone', async () => {
        const app = express();
        app.use('/api/', createRateLimiter({ max: 2 }));
        app.get('/api/ping', (req, res) => res.json({ ok: true }));
        // Fill the bucket with anonymous traffic…
        expect((await request(app).get('/api/ping')).status).toBe(200);
        expect((await request(app).get('/api/ping')).status).toBe(200);
        // …and the third request is blocked regardless of outcome.
        expect((await request(app).get('/api/ping')).status).toBe(429);
    });

    it('skipAuthenticated exempts requests carrying a session', async () => {
        const app = express();
        app.use('/api/', (req, _res, next) => { req.user = { id: 1 }; next(); });
        app.use('/api/', createRateLimiter({ max: 2, skipAuthenticated: true }));
        app.get('/api/ping', (req, res) => res.json({ ok: true }));
        const statuses = await Promise.all(
            [1, 2, 3, 4, 5].map(() => request(app).get('/api/ping').then(r => r.status)),
        );
        expect(statuses).toEqual([200, 200, 200, 200, 200]);
    });
});
