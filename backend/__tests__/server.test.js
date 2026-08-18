import { describe, it, expect, afterAll, vi } from 'vitest';
import request from 'supertest';
import { WebSocket } from 'ws';
import { app, server } from '../server.js';
import db from '../db/database.js';
import { updateSettings, getLocalUserId } from '../db/database.js';
import { HistoricalDataService } from '../services/HistoricalDataService.js';
import { clearModelCatalogCache } from '../services/LLMService.js';
import { assertContract, apiSchemas } from '../schemas/apiSchemas.js';

// The only network calls LLMService makes are to OpenRouter — mock them so
// the /api/llm/models route is testable offline. Other services use
// global.fetch (OracleService) and are unaffected by this module mock.
vi.mock('node-fetch', () => ({ default: vi.fn() }));
import fetch from 'node-fetch';

// E9 — open-mode identity for direct DB writes in tests.
const TEST_USER = () => getLocalUserId();

const WS_URL = 'ws://localhost:3001';

function wsConnect(protocols, timeout = 4000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL, protocols);
        const timer = setTimeout(() => {
            ws.terminate();
            reject(new Error('WS connection timed out'));
        }, timeout);
        ws.on('open', () => {
            clearTimeout(timer);
            resolve(ws);
        });
        ws.on('error', err => {
            clearTimeout(timer);
            reject(err);
        });
        ws.on('unexpected-response', (req, res) => {
            clearTimeout(timer);
            reject(new Error(`unexpected response: ${res.statusCode}`));
        });
    });
}

function wsConnectExpectFirstMessage(protocols, timeout = 4000) {
    return new Promise((resolve, reject) => {
        const ws = new WebSocket(WS_URL, protocols);
        const timer = setTimeout(() => { ws.terminate(); reject(new Error('WS timed out')); }, timeout);
        ws.on('message', data => {
            clearTimeout(timer);
            resolve(JSON.parse(data.toString()));
        });
        ws.on('error', err => { clearTimeout(timer); reject(err); });
        ws.on('unexpected-response', (req, res) => { clearTimeout(timer); reject(new Error(`rejected: ${res.statusCode}`)); });
    });
}

function wsExpectFailure(protocols, timeout = 4000) {
    return new Promise((resolve) => {
        const ws = new WebSocket(WS_URL, protocols);
        const timer = setTimeout(() => {
            ws.terminate();
            resolve('timeout');
        }, timeout);
        ws.on('open', () => {
            clearTimeout(timer);
            ws.close();
            resolve('opened');
        });
        ws.on('error', () => {
            clearTimeout(timer);
            resolve('errored');
        });
        ws.on('unexpected-response', (req, res) => {
            clearTimeout(timer);
            resolve('rejected:' + res.statusCode);
        });
    });
}

describe('API Integration Tests', () => {
    afterAll(() => {
        server.close();
        db.close();
    });

    it('GET /health should return 200 OK', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        expect(res.body.status).toBe('ok');
        expect(res.body).toHaveProperty('uptime');
    });

    it('GET /metrics exposes Prometheus metrics', async () => {
        // warm the request counter
        await request(app).get('/health');
        const res = await request(app).get('/metrics');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/plain');
        expect(res.text).toContain('aegis_http_requests_total');
        expect(res.text).toContain('aegis_http_duration_seconds');
        expect(res.text).toContain('aegis_ws_clients');
        expect(res.text).toContain('aegis_portfolio_tvl');
        expect(res.text).toContain('aegis_agent_running');
    });

    it('GET /api/portfolio/history should return array', async () => {
        const res = await request(app).get('/api/portfolio/history');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('GET /api/portfolio/metrics returns a complete risk report', async () => {
        const res = await request(app).get('/api/portfolio/metrics');
        expect(res.status).toBe(200);
        // No active simulation → periods 0, still a valid 200 with finite keys.
        expect(res.body.periods).toBeGreaterThanOrEqual(0);
        for (const key of ['sharpeRatio', 'sortinoRatio', 'annualizedVolatilityPct', 'historicalVaRPct', 'conditionalVaRPct', 'winRate']) {
            expect(Number.isFinite(res.body[key])).toBe(true);
        }
    });

    it('GET /api/forecast/:metric validates the metric and returns forecast shape', async () => {
        const bad = await request(app).get('/api/forecast/bogus');
        expect(bad.status).toBe(400);

        const res = await request(app).get('/api/forecast/netApy?horizon=5');
        expect(res.status).toBe(200);
        expect(res.body.metric).toBe('netApy');
        expect(Array.isArray(res.body.future)).toBe(true);
        expect(Array.isArray(res.body.fitted)).toBe(true);
        expect(res.body.future.length).toBeLessThanOrEqual(5);
        for (const f of res.body.future) {
            expect(Number.isFinite(f.value)).toBe(true);
            expect(Number.isFinite(f.upper)).toBe(true);
            expect(Number.isFinite(f.lower)).toBe(true);
            expect(f.upper).toBeGreaterThanOrEqual(f.lower);
        }
    });

    // ---- Contract tests: live responses must satisfy the zod schemas ----
    it('contract: /health matches health schema', async () => {
        const res = await request(app).get('/health');
        expect(res.status).toBe(200);
        assertContract(apiSchemas.health, res.body);
    });

    it('contract: /api/openapi.json is a valid OpenAPI 3.1 document', async () => {
        const res = await request(app).get('/api/openapi.json');
        expect(res.status).toBe(200);
        expect(res.body.openapi).toBe('3.1.0');
        expect(res.body.info.title).toBeDefined();
        expect(Object.keys(res.body.paths).length).toBeGreaterThan(10);
        // Every documented path exists on the live server.
        for (const path of Object.keys(res.body.paths)) {
            const expressPath = path.replace(/\{(\w+)\}/g, ':$1');
            const probe = await request(app).get(expressPath).set('Accept', 'application/json');
            expect([200, 400, 401, 404, 500]).toContain(probe.status);
        }
    });

    it('contract: /api/settings matches settings schema', async () => {
        const res = await request(app).get('/api/settings');
        expect(res.status).toBe(200);
        assertContract(apiSchemas.settings, res.body);
    });

    it('defaults the active model to a curated FREE model (no stored row)', async () => {
        await request(app).delete('/api/settings');
        const res = await request(app).get('/api/settings');
        expect(res.status).toBe(200);
        expect(res.body.activeModel).toBe('google/gemini-2.5-flash-exp:free');
    });

    it('contract: /api/simulation/status matches status schema', async () => {
        const res = await request(app).get('/api/simulation/status');
        expect(res.status).toBe(200);
        assertContract(apiSchemas.simulationStatus, res.body);
    });

    it('contract: /api/logs rows match the log schema', async () => {
        const res = await request(app).get('/api/logs');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        for (const row of res.body.slice(0, 10)) {
            assertContract(apiSchemas.logRow, row);
        }
    });

    it('contract: /api/portfolio/history rows match the history schema', async () => {
        const res = await request(app).get('/api/portfolio/history?limit=5');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        for (const row of res.body.slice(0, 5)) {
            assertContract(apiSchemas.portfolioHistoryRow, row);
        }
    });

    it('contract: /api/portfolio/metrics matches risk-metrics schema', async () => {
        const res = await request(app).get('/api/portfolio/metrics');
        expect(res.status).toBe(200);
        assertContract(apiSchemas.riskMetrics, res.body);
    });

    it('contract: /api/backtest matches backtest schema', async () => {
        const res = await request(app).get('/api/backtest?rangeDays=30&leverage=4');
        expect(res.status).toBe(200);
        if (res.body.error) {
            expect(typeof res.body.error).toBe('string');
        } else {
            assertContract(apiSchemas.backtest, res.body);
        }
    });

    it('contract: /api/backtest/monte-carlo matches MC schema', async () => {
        const res = await request(app).get('/api/backtest/monte-carlo?simulations=100&days=30&seed=7');
        expect(res.status).toBe(200);
        assertContract(apiSchemas.monteCarlo, res.body);
    });

    it('GET /api/logs should return array', async () => {
        const res = await request(app).get('/api/logs');
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
    });

    it('POST /api/simulation/start should validate input', async () => {
        await request(app)
            .post('/api/simulation/start')
            .send({ initialBalance: 'invalid_number' });

        // Zod validation should pass it as string, but parseFloat will make it NaN.
        // Wait, startSimulationSchema allows string or number.
        // Let's test a valid request with a unique name to avoid clashing
        // with simulations persisted in the local aegis.db.
        const validRes = await request(app)
            .post('/api/simulation/start')
            .send({ initialBalance: 15000, simulationName: `Test Sim ${Date.now()}`, dataMode: 'SIM' });

        expect(validRes.status).toBe(200);
        expect(validRes.body.success).toBe(true);
        expect(validRes.body.initialBalance).toBe(15000);
    });

    it('LIVE data mode requires RPC, but no key in auto/local brain mode', async () => {
        // The effective config includes the .env fallbacks (dotenv-loaded) —
        // stub them away plus wipe stored rows so the check sees emptiness.
        const savedKey = process.env.OPENROUTER_API_KEY;
        const savedRpc = process.env.EVM_PROVIDER_URL;
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.EVM_PROVIDER_URL;
        await request(app).delete('/api/settings');
        try {
            const res = await request(app)
                .post('/api/simulation/start')
                .send({ initialBalance: 10000, simulationName: `Live No Key ${Date.now()}` });
            expect(res.status).toBe(400);
            expect(res.body.error).toMatch(/LIVE market data requires/);
            expect(res.body.error).toMatch(/Sepolia RPC URL/);
            // Auto mode (default) does NOT demand an OpenRouter key.
            expect(res.body.error).not.toMatch(/OpenRouter API key/);
        } finally {
            if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
            if (savedRpc !== undefined) process.env.EVM_PROVIDER_URL = savedRpc;
        }
    });

    it('LIVE data mode requires the OpenRouter key only in AI-only brain mode', async () => {
        const savedKey = process.env.OPENROUTER_API_KEY;
        const savedRpc = process.env.EVM_PROVIDER_URL;
        delete process.env.OPENROUTER_API_KEY;
        delete process.env.EVM_PROVIDER_URL;
        await request(app).delete('/api/settings');
        try {
            // Provide RPC via request, but no key + brainMode llm → 400.
            const blocked = await request(app)
                .post('/api/simulation/start')
                .send({ initialBalance: 10000, rpcUrl: 'https://sepolia.example', brainMode: 'llm', simulationName: `Live Llm No Key ${Date.now()}` });
            expect(blocked.status).toBe(400);
            expect(blocked.body.error).toMatch(/OpenRouter API key/);

            // Same request in auto mode → key not needed, RPC present → starts.
            const allowed = await request(app)
                .post('/api/simulation/start')
                .send({ initialBalance: 10000, rpcUrl: 'https://sepolia.example', brainMode: 'auto', simulationName: `Live Auto No Key ${Date.now()}` });
            expect(allowed.status).toBe(200);
        } finally {
            if (savedKey !== undefined) process.env.OPENROUTER_API_KEY = savedKey;
            if (savedRpc !== undefined) process.env.EVM_PROVIDER_URL = savedRpc;
        }
    });

    it('LIVE data mode passes when keys arrive in the request body', async () => {
        const res = await request(app)
            .post('/api/simulation/start')
            .send({
                initialBalance: 10000,
                simulationName: `Live With Key ${Date.now()}`,
                rpcUrl: 'https://sepolia.test/v2/abc',
                openRouterKey: 'sk-or-v1-body-key',
            });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('SIM seeded mode starts without any keys (self-contained)', async () => {
        const res = await request(app)
            .post('/api/simulation/start')
            .send({ initialBalance: 10000, simulationName: `Sim No Key ${Date.now()}`, dataMode: 'SIM', dataScenario: 'bear' });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
    });

    it('rejects invalid dataMode/dataScenario values (400)', async () => {
        const badMode = await request(app)
            .post('/api/simulation/start')
            .send({ simulationName: `Bad Mode ${Date.now()}`, dataMode: 'ORACLE' });
        expect(badMode.status).toBe(400);

        const badScenario = await request(app)
            .post('/api/simulation/start')
            .send({ simulationName: `Bad Scenario ${Date.now()}`, dataMode: 'SIM', dataScenario: 'tsunami' });
        expect(badScenario.status).toBe(400);
    });

    it('GET /api/llm/models returns the OpenRouter catalog, free models first', async () => {
        fetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            statusText: 'OK',
            json: async () => ({ data: [
                { id: 'zeta/paid', name: 'Zeta Paid', context_length: 8000, pricing: { prompt: '1', completion: '2' } },
                { id: 'alpha/free', name: 'Alpha Free', context_length: 4000, pricing: { prompt: '0', completion: '0' } },
            ] }),
        });
        const res = await request(app).get('/api/llm/models');
        expect(res.status).toBe(200);
        expect(res.body.models.map(m => m.id)).toEqual(['alpha/free', 'zeta/paid']);
        // curated zero-credit fallback list is always served alongside
        expect(Array.isArray(res.body.freeModels)).toBe(true);
        expect(res.body.freeModels.length).toBeGreaterThan(0);
        expect(res.body.freeModels.every(m => m.isFree === true)).toBe(true);
    });

    it('GET /api/llm/models returns 502 when OpenRouter is unreachable', async () => {
        clearModelCatalogCache();
        fetch.mockRejectedValueOnce(new Error('network down'));
        const res = await request(app).get('/api/llm/models');
        expect(res.status).toBe(502);
        expect(res.body.error).toBeTruthy();
    });

    it('GET /api/simulation/suggest-name returns a fresh unique sim_<hex> name', async () => {
        const first = await request(app).get('/api/simulation/suggest-name');
        const second = await request(app).get('/api/simulation/suggest-name');
        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(first.body.suggestedName).toMatch(/^sim_[0-9a-f]{8}$/);
        // Mage-style: every call yields a different random token.
        expect(first.body.suggestedName).not.toBe(second.body.suggestedName);
        // Must never collide with an existing simulation name.
        await request(app)
            .post('/api/simulation/start')
            .send({ initialBalance: 10000, simulationName: first.body.suggestedName, dataMode: 'SIM' });
        expect((await request(app).get('/api/simulation/suggest-name')).body.suggestedName)
            .not.toBe(first.body.suggestedName);
    });

    // Hermetic dataset so the backtest endpoints never touch live oracles in
    // CI (external DefiLlama/RPC calls were the source of flaky runs).
    function seedBacktestDataset() {
        const days = [];
        for (let i = 0; i < 60; i++) {
            const date = new Date(Date.now() - (59 - i) * 86400000).toISOString().slice(0, 10);
            days.push({ date, susdeApy: 12.5, borrowApy: 4.2, fundingApy: 2.0 });
        }
        vi.spyOn(HistoricalDataService, 'buildBacktestDataset').mockResolvedValue(days);
    }

    it('GET /api/backtest should return a report', async () => {
        seedBacktestDataset();
        const res = await request(app).get('/api/backtest').query({ rangeDays: 30, leverage: 4 });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('strategy');
        expect(res.body).toHaveProperty('sharpe');
        expect(res.body).toHaveProperty('maxDrawdown');
    });

    it('GET /api/simulation/export returns CSV with history and logs (B2.5-10)', async () => {
        await updateSettings({ dataMode: 'SIM', dataScenario: 'stable' }, null, TEST_USER());
        const start = await request(app)
            .post('/api/simulation/start')
            .send({ initialBalance: 10000, simulationName: `Export Sim ${Date.now()}`, frequency: 'Low', dataMode: 'SIM' });
        expect(start.status).toBe(200);

        const res = await request(app).get('/api/simulation/export');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toContain('text/csv');
        expect(res.text).toContain('# Portfolio History');
        expect(res.text).toContain('timestamp,tvl,netApy,healthFactor');
        expect(res.text).toContain('# Agent Logs');

        // Export must still work after stopping (the whole point: grab the report)
        await request(app).post('/api/simulation/stop');
        const after = await request(app).get('/api/simulation/export');
        expect(after.status).toBe(200);
        expect(after.text).toContain('# Portfolio History');
        await updateSettings({ dataMode: 'LIVE', dataScenario: 'stable' }, null, TEST_USER());
    });

    it('GET /api/backtest/monte-carlo should return distribution stats', async () => {
        const res = await request(app).get('/api/backtest/monte-carlo').query({ simulations: 100, days: 30, seed: 1 });
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('liquidationProbability');
        expect(res.body).toHaveProperty('medianReturnPct');
        expect(res.body.liquidationProbability).toBeGreaterThanOrEqual(0);
    });

    it('GET /api/backtest/sweep should return leverage rows', async () => {
        seedBacktestDataset();
        const res = await request(app).get('/api/backtest/sweep').query({ leverages: '2,3,4' });
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body)).toBe(true);
        expect(res.body.length).toBe(3);
    });

    it('POST /api/settings persists automation rules', async () => {
        const res = await request(app)
            .post('/api/settings')
            .send({
                rpcUrl: '',
                slippage: '0.5',
                dataMode: 'SIM',
                dataScenario: 'bear',
                automationRules: [{ id: 'api-1', condition: 'HF < 1.3', action: 'Rebalance', enabled: true }],
            });
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(res.body.settings.dataMode).toBe('SIM');
        expect(res.body.settings.automationRules).toHaveLength(1);
        expect(res.body.settings.automationRules[0].action).toBe('Rebalance');

        const fetched = await request(app).get('/api/settings');
        expect(fetched.body.automationRules).toHaveLength(1);
        expect(fetched.body.automationRules[0].id).toBe('api-1');
    });

    it('POST /api/settings accepts a valid brainMode and rejects invalid ones', async () => {
        const ok = await request(app).post('/api/settings').send({ brainMode: 'local' });
        expect(ok.status).toBe(200);
        expect(ok.body.success).toBe(true);
        expect(ok.body.settings.brainMode).toBe('local');

        const okAuto = await request(app).post('/api/settings').send({ brainMode: 'auto' });
        expect(okAuto.status).toBe(200);

        const bad = await request(app).post('/api/settings').send({ brainMode: 'garbage' });
        expect(bad.status).toBe(400);
        expect(bad.body.error).toBeTruthy();
    });

    it('persists riskAppetite and frequency and rejects invalid values', async () => {
        const ok = await request(app).post('/api/settings').send({ riskAppetite: 'Aggressive', frequency: 'High' });
        expect(ok.status).toBe(200);
        expect(ok.body.settings.riskAppetite).toBe('Aggressive');
        expect(ok.body.settings.frequency).toBe('High');

        const badA = await request(app).post('/api/settings').send({ riskAppetite: 'Wild' });
        expect(badA.status).toBe(400);

        const badF = await request(app).post('/api/settings').send({ frequency: 'Insane' });
        expect(badF.status).toBe(400);
    });

    it('never exposes stored secrets via /api/settings (B5 masking)', async () => {
        const secret = 'sk-masking-check';
        const post = await request(app).post('/api/settings').send({
            rpcUrl: 'https://alchemy.example/v2/alch_secret',
            openRouterKey: secret,
        });
        expect(post.status).toBe(200);

        const get = await request(app).get('/api/settings');
        expect(get.body.openRouterKey).not.toBe(secret);
        expect(get.body.rpcUrl).not.toContain('alch_secret');
        expect(get.body.hasOpenRouterKey).toBe(true);
        expect(get.body.hasRpcUrl).toBe(true);
        // the masked placeholder is never persisted back
        const post2 = await request(app).post('/api/settings').send({
            openRouterKey: '••••••••••••••••',
            rpcUrl: '••••••••••••••••',
        });
        expect(post2.status).toBe(200);
        const get2 = await request(app).get('/api/settings');
        expect(get2.body.hasOpenRouterKey).toBe(true);
        expect(get2.body.hasRpcUrl).toBe(true);
    });

    it('rejects out-of-range money-adjacent settings (B6 schema)', async () => {
        const badSlippage = await request(app).post('/api/settings').send({ slippage: 150 });
        expect(badSlippage.status).toBe(400);
        const badSlippage2 = await request(app).post('/api/settings').send({ slippage: 'Infinity' });
        expect(badSlippage2.status).toBe(400);
    });

    it('rejects invalid initial balances (B6 schema)', async () => {
        const bad = await request(app).post('/api/simulation/start').send({ initialBalance: -1000 });
        expect(bad.status).toBe(400);
        const bad2 = await request(app).post('/api/simulation/start').send({ initialBalance: 'Infinity' });
        expect(bad2.status).toBe(400);
        const nan = await request(app).post('/api/simulation/start').send({ initialBalance: 'abc' });
        expect(nan.status).toBe(400);
    });

    it('full agent cycle runs end-to-end in SIM mode without crashing', async () => {
        // SIM mode → no external network. Bear scenario forces a critical path
        // (flash loan rescue) which exercises RiskEngine → DecisionEngine → SimulationExecution.
        await updateSettings({ dataMode: 'SIM', dataScenario: 'bear' }, null, TEST_USER());

        const start = await request(app)
            .post('/api/simulation/start')
            .send({ initialBalance: 10000, simulationName: `Cycle Sim ${Date.now()}`, frequency: 'High', dataMode: 'SIM' });
        expect(start.status).toBe(200);
        expect(start.body.success).toBe(true);

        // Wait for the first (unawaited) agent cycle + its 3s settlement timer
        await new Promise(r => setTimeout(r, 5000));

        // Server must still be responsive (regression: SQLite binding crash used to kill it)
        const health = await request(app).get('/health');
        expect(health.status).toBe(200);

        const logs = await request(app).get('/api/logs');
        expect(logs.status).toBe(200);
        const decisions = logs.body.map(l => l.type);
        // The critical path must have produced agent decision logs
        expect(decisions.some(t => t === 'flash_loan' || t === 'de_leverage' || t === 'system' || t === 'scan')).toBe(true);

        // Stop the simulation to avoid stray timers across the suite
        await request(app).post('/api/simulation/stop');
        await updateSettings({ dataMode: 'LIVE', dataScenario: 'stable' }, null, TEST_USER());
    }, 20000);

    it('a stopped simulation is marked STOPPED in the list (not lingering ACTIVE)', async () => {
        // Fresh run so the assertion targets the simulation we control.
        await request(app).post('/api/simulation/start').send({ simulationName: `stop-state ${Date.now()}`, dataMode: 'SIM' });
        await new Promise(r => setTimeout(r, 800));
        await request(app).post('/api/simulation/stop');
        const list = await request(app).get('/api/simulations');
        expect(list.status).toBe(200);
        const latest = list.body[0];
        expect(latest.status).toBe('STOPPED');
    });

    it('GET /api/simulation/status reports the execution backend', async () => {
        const res = await request(app).get('/api/simulation/status');
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty('isRunning', false);
        expect(res.body.execution).toMatchObject({
            mode: 'simulation',
            ready: true,
        });
    });

    it('WebSocket connects with a valid subprotocol and receives status', async () => {
        const first = await wsConnectExpectFirstMessage(['aegis-default-ws-key']);
        expect(['portfolio_update', 'simulation_status', 'agent_log']).toContain(first.type);
        if (first.type === 'simulation_status') {
            expect(first.payload.execution.mode).toBe('simulation');
        }
    });

    it('WebSocket rejects an invalid subprotocol in production', async () => {
        const prevEnv = process.env.NODE_ENV;
        const prevKey = process.env.WS_API_KEY;
        process.env.NODE_ENV = 'production';
        process.env.WS_API_KEY = 'prod-secret-key';
                try {
            const outcome = await wsExpectFailure(['wrong-key']);
            expect(outcome).not.toBe('opened');
            // correct key must still work
            const ws = await wsConnect(['prod-secret-key'], 5000);
            ws.close();
        } finally {
            process.env.NODE_ENV = prevEnv;
            process.env.WS_API_KEY = prevKey;
        }
    });

    it('REST API requires x-api-key when AEGIS_API_KEY is configured', async () => {
        const prevKey = process.env.AEGIS_API_KEY;
        process.env.AEGIS_API_KEY = 'rest-secret';
        try {
            const denied = await request(app).get('/api/settings');
            expect(denied.status).toBe(401);

            const allowed = await request(app).get('/api/settings').set('x-api-key', 'rest-secret');
            expect(allowed.status).toBe(200);

            // health stays public
            const health = await request(app).get('/health');
            expect(health.status).toBe(200);
        } finally {
            // prevKey may be undefined — assigning it would set the STRING
            // "undefined" (truthy) and 401 every later request. Delete instead.
            if (prevKey) process.env.AEGIS_API_KEY = prevKey;
            else delete process.env.AEGIS_API_KEY;
        }
    });

    it('data endpoints return arrays when the active sim is owned by another user (no 404 object)', async () => {
        // Regression: activeSimForUser used to answer a not-owned active
        // simulation with 404 {error}; array-consuming frontends (logs,
        // history) crashed with "filter is not a function".
        // Runs last: it mutates the active simulation's ownership.
        const start = await request(app)
            .post('/api/simulation/start')
            .send({ initialBalance: 10000, frequency: 'Low', simulationName: `ownership ${Date.now()}`, dataMode: 'SIM' });
        expect(start.status).toBe(200);
        const simId = db.prepare('SELECT id FROM simulations ORDER BY id DESC LIMIT 1').get().id;
        // Steal the sim from the local user — simulating a pre-E9 row or
        // another account's active simulation.
        db.prepare('UPDATE simulations SET user_id = 999999 WHERE id = ?').run(simId);

        const logsRes = await request(app).get('/api/logs');
        expect(logsRes.status).toBe(200);
        expect(Array.isArray(logsRes.body)).toBe(true);

        const histRes = await request(app).get('/api/portfolio/history?limit=10');
        expect(histRes.status).toBe(200);
        expect(Array.isArray(histRes.body)).toBe(true);

        // Restore ownership so the stop endpoint can clean up after itself.
        db.prepare('UPDATE simulations SET user_id = ? WHERE id = ?').run(getLocalUserId(), simId);
        await request(app).post('/api/simulation/stop');
    });
});
