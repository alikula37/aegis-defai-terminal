// Stress suite — bounded, CI-safe (target < 20s), network-independent.
// Exercises: concurrent API traffic, DB churn + prune, session churn, agent
// start/stop timer hygiene, memory bounds, WebSocket concurrency.
//
// PORT is pinned to 3101 BEFORE importing server.js so this file can run in
// parallel with server.test.js (which owns 3001) without EADDRINUSE.
// LLM is mocked to fail → the agent always takes the deterministic fallback
// (offline path), so nothing here touches external services.

process.env.PORT = '3101';

vi.mock('../services/LLMService.js', () => ({
    callLLM: vi.fn(async () => { throw new Error('mocked llm down (stress)'); }),
    callLLMWithTools: vi.fn(async () => ({ content: null, toolCalls: [] })),
    isRetriableLLMError: vi.fn(() => false),
}));

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import request from 'supertest';
import { WebSocket } from 'ws';
import { join } from 'path';
import { tmpdir } from 'os';
import { rmSync } from 'fs';
import { AegisAgent } from '../agent.js';

// ESM hoisting: static imports run BEFORE the env assignments, so server.js
// AND database.js are imported dynamically (after the env is set).
//   - PORT=3101 avoids EADDRINUSE with server.test.js's worker (port 3001).
//   - AEGIS_DB_PATH points at a throwaway file so the stress churn (1000+
//     inserts) never contends with the other suites' writes on aegis.db.
const STRESS_DB = join(tmpdir(), `aegis-stress-${process.pid}.db`);

let app = null;
let server = null;
let dbfns = null;
let serverModule = null;

beforeAll(async () => {
    process.env.AEGIS_DB_PATH = STRESS_DB;
    serverModule = await import('../server.js');
    app = serverModule.app;
    server = serverModule.server;
    dbfns = await import('../db/database.js');
});

const LOCAL = () => dbfns.getLocalUserId();
const WS_URL = 'ws://localhost:3101';

function wsConnect(protocols = 'aegis-default-ws-key', timeout = 15000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL, protocols);
        const timer = setTimeout(() => { ws.terminate(); reject(new Error('ws connect timeout')); }, timeout);
        ws.on('open', () => { clearTimeout(timer); resolve(ws); });
        ws.on('error', (e) => { clearTimeout(timer); reject(e); });
    });
}

function onceMessage(ws, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('ws message timeout')), timeout);
        ws.once('message', (data) => { clearTimeout(timer); resolve(JSON.parse(String(data))); });
    });
}

describe('Stress — API concurrency', () => {
    it('handles 50 concurrent GET + 20 concurrent POST without errors', async () => {
        const gets = Array.from({ length: 50 }, () => request(app).get('/api/simulations'));
        const getResults = await Promise.all(gets);
        expect(getResults.every(r => r.status === 200)).toBe(true);

        const posts = Array.from({ length: 20 }, (_, i) =>
            request(app).post('/api/simulation/start').send({
                initialBalance: 10000,
                simulationName: `Stress Start ${i}-${Date.now()}`,
                frequency: 'Low',
                dataMode: 'SIM',
            }));
        const postResults = await Promise.all(posts);
        expect(postResults.every(r => r.status === 200)).toBe(true);

        const stop = await request(app).post('/api/simulation/stop');
        expect(stop.status).toBe(200);
    }, 30000);

    it('survives 100 rapid requests without premature 429s (exact boundary lives in rate-limit.test.js)', async () => {
        const results = await Promise.all(Array.from({ length: 100 }, () => request(app).get('/api/simulations')));
        expect(results.every(r => r.status === 200)).toBe(true);
    }, 30000);
});

describe('Stress — DB churn', () => {
    it('ingests 1000 portfolio rows then prunes to the per-user limit', async () => {
        const sim = await dbfns.resetPortfolio(10000, 'Churn Sim', null, LOCAL());
        for (let i = 0; i < 1000; i++) {
            dbfns.insertPortfolioStats(10000 + i, 5 + (i % 10), 1.5, [{ name: 'x' }], { ethPrice: 2500 }, sim.simulationId);
        }
        const latest = await dbfns.getLatestPortfolio(sim.simulationId);
        expect(latest.tvl).toBe(10999);

        await dbfns.resetPortfolio(5000, 'Prune Stress', null, LOCAL());
        const sims = await dbfns.getAllSimulations(LOCAL());
        // 5 kept + 1 new (the prune keeps the 5 most recent of this user)
        expect(sims.length).toBeLessThanOrEqual(6);
    }, 30000);

    it('survives 100 session create/verify/delete cycles', () => {
        const uid = dbfns.createUser(`stress_${Date.now()}`, 'hash', 'user');
        for (let i = 0; i < 100; i++) {
            const { token } = dbfns.createSession(uid);
            const session = dbfns.getSessionUser(token);
            expect(session.id).toBe(uid);
            dbfns.deleteSession(token);
        }
        expect(dbfns.getSessionUser('bogus-token')).toBeNull();
    }, 30000);

    it('appends 200 settings rows and always reads the latest', async () => {
        const uid = LOCAL();
        for (let i = 0; i < 200; i++) {
            await dbfns.updateSettings({ slippage: String((i % 100) / 10), dataMode: 'SIM' }, null, uid);
        }
        const s = await dbfns.getSettings(uid);
        expect(s.slippage).toBe('9.9');
    }, 30000);
});

describe('Stress — agent lifecycle', () => {
    it('start/stop x3 leaves no running agent and no timer leaks', async () => {
        await dbfns.updateSettings({ dataMode: 'SIM', dataScenario: 'stable' }, null, LOCAL());
        const before = process.memoryUsage().heapUsed;
        for (let i = 0; i < 3; i++) {
            const agent = new AegisAgent(() => {});
            await agent.startSimulation(10000, { frequency: 'Low' }, `Lifecycle ${i}-${Date.now()}`, { ownerUserId: LOCAL() });
            expect(agent.isRunning).toBe(true);
            await new Promise(r => setTimeout(r, 150)); // let the first cycle settle
            agent.stopSimulation();
            expect(agent.isRunning).toBe(false);
            expect(agent.cycleTimeoutId).toBeNull();
        }
        const delta = process.memoryUsage().heapUsed - before;
        // 3 agent instances + cycles must not leak hundreds of MB
        expect(delta).toBeLessThan(150 * 1024 * 1024);
    }, 60000);
});

describe('Stress — WebSocket concurrency', () => {
    it('handles 30 concurrent clients and closes cleanly', async () => {
        const clients = await Promise.all(Array.from({ length: 30 }, () => wsConnect()));
        const firstMessages = await Promise.all(clients.map(ws => onceMessage(ws)));
        for (const msg of firstMessages) {
            expect(['simulation_status', 'portfolio_update']).toContain(msg.type);
        }
        const closed = clients.map(ws => new Promise(resolve => ws.on('close', resolve)));
        clients.forEach(ws => ws.close());
        await Promise.all(closed);
    }, 30000);
}, 60000);

afterAll(async () => {
    try { dbfns?.closeDatabase(); } catch { /* already closed */ }
    try { server?.close(); } catch { /* already closed */ }
    try { rmSync(STRESS_DB, { force: true }); } catch { /* best-effort cleanup */ }
    try { rmSync(`${STRESS_DB}-wal`, { force: true }); } catch { /* ignore */ }
    try { rmSync(`${STRESS_DB}-shm`, { force: true }); } catch { /* ignore */ }
});
