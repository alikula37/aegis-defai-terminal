// B6 — rate-limit guard behavior, tested in isolation so the shared test app's
// global limiters can't be tripped by the assertions.
import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRateLimiter } from '../utils/rateLimit.js';

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
});
