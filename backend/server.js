import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { getLogs, getLatestPortfolio, getInitialPortfolio, getPortfolioHistory, getSettings, updateSettings, deleteSettings, getRecentMemories, closeDatabase, checkSimulationNameExists, generateUniqueSimulationName, getLatestSimulation, setSimulationStatus, getAllSimulations, deleteSimulation, getSimulationById, getLocalUserId } from './db/database.js';
import { AegisAgent } from './agent.js';
import { Backtester } from './backtest/Backtester.js';
import aegisConfig from './aegis.config.js';
import helmet from 'helmet';
import { z } from 'zod';
import logger from './utils/logger.js';
import { validateWsSubprotocol, expectedWsKey } from './utils/wsAuth.js';
import { createMetrics } from './monitoring/metrics.js';
import { initTracing } from './monitoring/tracing.js';
import { apiKeyMiddleware } from './utils/apiAuth.js';
import { createRateLimiter } from './utils/rateLimit.js';
import {
    isAuthRequired, createAuthMiddleware, createOriginCheck,
    getSessionToken, getSessionUser,
} from './utils/auth.js';
import { createAuthRouter } from './routes/authRoutes.js';

dotenv.config();

const app = express();
const server = createServer(app);
const metrics = createMetrics();

// Phase 4 (D8) — OpenTelemetry spans folded into the prom-client registry.
// Enable with OTEL_ENABLED=true (docs/OBSERVABILITY.md).
initTracing({ registry: metrics.registry, enabled: process.env.OTEL_ENABLED === 'true' });
const wss = new WebSocketServer({
    server,
    // Auth via Sec-WebSocket-Protocol subprotocol (not query string)
    handleProtocols(protocols) {
        const accepted = validateWsSubprotocol(protocols, expectedWsKey(), process.env.NODE_ENV === 'production');
        if (!accepted) {
            logger.warn('[SECURITY] WebSocket handshake rejected: no valid subprotocol.');
        }
        return accepted;
    },
});

app.use(express.json());

const allowedOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:5173'];
app.use(cors({
    origin: function (origin, callback) {
        if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    },
    // E9 — session cookie rides on cross-origin dev calls (5173 → 3001).
    credentials: true,
}));

app.use(helmet());

// E9 — auth: open mode (AUTH_REQUIRED=false, dev default) attaches the seeded
// 'local' user; required mode (production default) validates the session cookie.
// /api/auth/* is exempt: login/register must work before a session exists.
const authRequired = isAuthRequired();
const requireAuthMw = createAuthMiddleware({ authRequired });
app.use('/api/', createOriginCheck({ allowedOrigins }));
app.use('/api/', (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    return requireAuthMw(req, res, next);
});

// Brute-force ceiling on credential endpoints — always on, both modes.
const loginLimiter = createRateLimiter({
    windowMs: aegisConfig.server.rateLimit.loginWindowMs,
    max: aegisConfig.server.rateLimit.loginMax, // per IP: register/login/logout combined
});
app.use('/api/auth/', loginLimiter);

const apiLimiter = createRateLimiter({
    windowMs: aegisConfig.server.rateLimit.apiWindowMs,
    max: Number(process.env.RATE_LIMIT_API_MAX) || aegisConfig.server.rateLimit.apiMax, // per IP
});
app.use('/api/', apiLimiter);

// Stricter ceiling on state-changing endpoints (B6) — brute-force / abuse guard.
const writeLimiter = createRateLimiter({
    windowMs: aegisConfig.server.rateLimit.writeWindowMs,
    max: Number(process.env.RATE_LIMIT_WRITE_MAX) || aegisConfig.server.rateLimit.writeMax,
});
app.use('/api/', (req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return writeLimiter(req, res, next);
    return next();
});

// ---- Optional API key auth (B2.5-2) ----
// Enabled by setting AEGIS_API_KEY. When set, every /api request must carry
// `x-api-key: <AEGIS_API_KEY>`. When unset the API stays open (local dev).
// In production writes fail closed. Auth endpoints are exempt (a login must
// never depend on a key the operator is still configuring). E9: when session
// auth is active (AUTH_REQUIRED) and no explicit key is set, the fail-closed
// write guard would block every post-login action — session auth supersedes it.
// (Middleware lives in utils/apiAuth.js so it can be unit-tested without
// booting the HTTP server.)
app.use('/api/', (req, res, next) => {
    if (req.path.startsWith('/auth/')) return next();
    if (authRequired && !process.env.AEGIS_API_KEY) return next();
    return apiKeyMiddleware(req, res, next);
});

// Request logging + metrics middleware
app.use((req, res, next) => {
    logger.info(`${req.method} ${req.url}`);
    const start = process.hrtime.bigint();
    res.on('finish', () => {
        const durationSec = Number(process.hrtime.bigint() - start) / 1e9;
        metrics.httpDuration.labels(req.method, req.route?.path || req.path).observe(durationSec);
        metrics.httpRequests.labels(req.method, req.route?.path || req.path, res.statusCode).inc();
    });
    next();
});

// ---- WebSocket Broadcast ----
// E9 — clients are grouped per user so a user only ever receives their own
// simulation state (open mode: every socket belongs to the local user).
const clientsByUser = new Map(); // userId → Set<ws>

function addClient(userId, ws) {
    if (!clientsByUser.has(userId)) clientsByUser.set(userId, new Set());
    clientsByUser.get(userId).add(ws);
    metrics.wsClients.set(totalClients());
}

function removeClient(userId, ws) {
    const userSockets = clientsByUser.get(userId);
    if (userSockets) {
        userSockets.delete(ws);
        if (userSockets.size === 0) clientsByUser.delete(userId);
    }
    metrics.wsClients.set(totalClients());
}

function totalClients() {
    let n = 0;
    for (const set of clientsByUser.values()) n += set.size;
    return n;
}

function allSockets() {
    const all = [];
    for (const set of clientsByUser.values()) all.push(...set);
    return all;
}

// Faz 2.5 (B2.5-11) — heartbeat: ping idle clients every 30s and drop dead
// ones so the client gauge and the connection pool stay accurate.
const WS_HEARTBEAT_INTERVAL_MS = aegisConfig.server.wsHeartbeatIntervalMs;
const wsHeartbeat = setInterval(() => {
    for (const ws of allSockets()) {
        if (ws.isAlive === false) {
            removeClient(ws.userId, ws);
            ws.terminate();
            continue;
        }
        // E9 — re-validate the session on every heartbeat: a logged-out or
        // expired session must stop streaming within one interval (≤30s).
        if (ws.sessionToken && !getSessionUser(ws.sessionToken)) {
            removeClient(ws.userId, ws);
            try { ws.close(4001, 'Session ended'); } catch { ws.terminate(); }
            continue;
        }
        ws.isAlive = false;
        try {
            ws.ping();
        } catch {
            removeClient(ws.userId, ws);
        }
    }
    metrics.wsClients.set(totalClients());
}, WS_HEARTBEAT_INTERVAL_MS);

wss.on('connection', async (ws, req) => {
    // E9 — authenticate the socket with the session cookie (browser sends it
    // on the handshake automatically). Required mode: invalid session →
    // close immediately. Open mode: every socket is the local user.
    let userId;
    let sessionToken = null;
    if (authRequired) {
        const token = getSessionToken({ headers: req.headers });
        const session = getSessionUser(token);
        if (!session) {
            ws.close(1008, 'Unauthorized');
            return;
        }
        userId = session.id;
        sessionToken = token;
    } else {
        userId = getLocalUserId();
    }
    ws.userId = userId;
    ws.sessionToken = sessionToken;
    addClient(userId, ws);
    logger.info(`WebSocket client connected (user ${userId})`);
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Send the latest portfolio from DB immediately on connect — only when the
    // active simulation belongs to the connecting user.
    try {
        if (agent.activeSimulationId) {
            const owned = await getSimulationById(agent.activeSimulationId, userId);
            if (owned) {
                const portfolio = await getLatestPortfolio(agent.activeSimulationId);
                ws.send(JSON.stringify({
                    type: 'portfolio_update',
                    payload: portfolio
                }));
            }
        }
        ws.send(JSON.stringify({
            type: 'simulation_status',
            payload: { isRunning: agent.isRunning, execution: agent.getExecutionStatus() }
        }));
    } catch (e) {
        logger.error(`Failed to send initial portfolio: ${e.message}`);
    }

    // Trigger an oracle refresh so new clients get live data immediately
    // (runs asynchronously — won't block the connection handshake)
    agent._broadcastOracle().catch(() => { });

    ws.on('close', () => {
        removeClient(userId, ws);
        logger.info('WebSocket client disconnected');
    });
});

function sendToUser(userId, message) {
    const userSockets = clientsByUser.get(userId);
    if (!userSockets) return;
    for (const client of userSockets) {
        if (client.readyState === 1) { // OPEN
            try {
                client.send(message);
            } catch (err) {
                removeClient(userId, client);
                logger.debug(`WS broadcast to dead client dropped: ${err.message}`);
            }
        }
    }
}

function broadcastToAll(type, payload) {
    const message = JSON.stringify({ type, payload });
    for (const ws of allSockets()) sendToUser(ws.userId, message);
}

function broadcast(type, payload) {
    // portfolio/oracle/agent-log/notification streams belong to the OWNER of
    // the running simulation; simulation_status is global agent state.
    const owner = agent.ownerUserId ?? getLocalUserId();
    if (type === 'simulation_status') {
        broadcastToAll(type, payload);
    } else {
        sendToUser(owner, JSON.stringify({ type, payload }));
    }
    // Keep the TVL gauge fresh on every portfolio broadcast
    if (type === 'portfolio_update' && payload && typeof payload.tvl === 'number') {
        metrics.portfolioTvl.set(payload.tvl);
    }
}

// Initialize the AI Agent (but don't start it yet)
const agent = new AegisAgent(broadcast, { metrics });

// Start passive oracle ticker immediately — broadcasts live data even when simulation is idle
agent.startOracleTicker();

// ---- REST API Routes ----
app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime(), wsClients: totalClients() });
});

// Prometheus metrics endpoint (B2.5-6)
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', 'text/plain; version=0.0.4');
        res.send(await metrics.render());
    } catch (err) {
        res.status(500).send(err.message);
    }
});
const startSimulationSchema = z.object({
    initialBalance: z.union([z.string(), z.number()]).optional(),
    frequency: z.string().optional(),
    riskAppetite: z.string().optional(),
    simulationName: z.string().optional(),
    seed: z.union([z.string(), z.number()]).optional(),
}).passthrough()
    // B6 — reject NaN/Infinity/negative/absurd balances at the schema layer
    .superRefine((val, ctx) => {
        if (val.initialBalance === undefined) return;
        const num = typeof val.initialBalance === 'number' ? val.initialBalance : parseFloat(val.initialBalance);
        if (Number.isNaN(num) || num <= 0 || num > aegisConfig.server.maxInitialBalance) {
            ctx.addIssue({ code: 'custom', path: ['initialBalance'], message: 'initialBalance must be > 0 and ≤ 1e12' });
        }
    });

app.post('/api/simulation/start', async (req, res) => {
    try {
        const settings = startSimulationSchema.parse(req.body);
        // Clamp the balance: NaN/Infinity/negative/absurd values would corrupt
        // the persisted portfolio baseline.
        const rawBalance = Number(settings.initialBalance);
        const initialBalance = Number.isFinite(rawBalance) && rawBalance > 0
            ? Math.min(rawBalance, aegisConfig.server.maxInitialBalance)
            : aegisConfig.server.defaultInitialBalance;
        const simulationName = settings.simulationName || 'Default Simulation';

        if (!settings.isResume) {
            // E9 — name uniqueness is per user now.
            if (checkSimulationNameExists(simulationName, req.user.id)) {
                const suggestedName = generateUniqueSimulationName(simulationName, req.user.id);
                return res.status(400).json({
                    error: 'Simulation name already exists.',
                    suggestedName
                });
            }
        }

        await agent.startSimulation(initialBalance, settings, simulationName, { ownerUserId: req.user.id });
        metrics.agentRunning.set(1);
        res.json({ success: true, message: 'Simulation started', initialBalance, simulationName });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/simulation/stop', async (req, res) => {
    try {
        // E9 — only the owner of the running simulation can stop it. If the
        // agent is running another user's sim this is a 404 (no existence leak).
        if (agent.activeSimulationId) {
            const owned = await getSimulationById(agent.activeSimulationId, req.user.id);
            if (!owned) return res.status(404).json({ error: 'Simulation not found' });
        }
        agent.stopSimulation();
        metrics.agentRunning.set(0);
        res.json({ success: true, message: 'Simulation stopped' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/simulation/resume', async (req, res) => {
    try {
        if (agent.isRunning) {
            return res.status(400).json({ error: 'Simulation is already running' });
        }

        const { simulationId } = req.body;
        let simToResume;
        if (simulationId) {
            // E9 — ownership enforced: another user's simulation is invisible.
            simToResume = await getSimulationById(parseInt(simulationId), req.user.id);
        } else {
            simToResume = await getLatestSimulation(req.user.id);
        }

        if (!simToResume) {
            return res.status(400).json({ error: 'No simulation to resume' });
        }

        agent.activeSimulationId = simToResume.id;

        const latestPortfolio = await getLatestPortfolio(agent.activeSimulationId);
        const initialBalance = latestPortfolio ? latestPortfolio.tvl : aegisConfig.server.defaultInitialBalance;
        const simulationName = simToResume.name;

        const settings = await getSettings(req.user.id);

        await setSimulationStatus(simToResume.id, 'ACTIVE', req.user.id);

        await agent.startSimulation(initialBalance, { ...settings, isResume: true }, simulationName, { ownerUserId: req.user.id });
        res.json({ success: true, message: 'Simulation resumed', initialBalance, simulationName });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/simulations', async (req, res) => {
    try {
        // E9 — a user only ever lists their own simulations.
        const simulations = await getAllSimulations(req.user.id);
        res.json(simulations);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/simulation/:id', async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        if (isNaN(id)) {
            return res.status(400).json({ error: 'Invalid simulation ID' });
        }

        // E9 — ownership enforced in the DB layer; another user's id → 404.
        if (agent.activeSimulationId === id && agent.ownerUserId === req.user.id) {
            agent.stopSimulation();
            agent.activeSimulationId = null;
        }

        const deleted = await deleteSimulation(id, req.user.id);
        if (!deleted) return res.status(404).json({ error: 'Simulation not found' });
        res.json({ success: true, message: 'Simulation deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/simulation/reset', async (req, res) => {
    try {
        // E9 — reset wipes the owner's data; only the running sim's owner may.
        if (agent.activeSimulationId) {
            const owned = await getSimulationById(agent.activeSimulationId, req.user.id);
            if (!owned) return res.status(404).json({ error: 'Simulation not found' });
        }
        await agent.resetSimulation();
        res.json({ success: true, message: 'Simulation reset' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/simulation/status', (req, res) => {
    res.json({
        isRunning: agent.isRunning,
        startTime: agent.startTime,
        execution: agent.getExecutionStatus(),
    });
});

// ---- E9 ownership helper ----
// Every data endpoint below streams the ACTIVE simulation (single global
// agent). Only its owner may read it; everyone else sees an empty/404 response
// (no existence leak). Open mode = everyone is the local user → unchanged.
async function activeSimForUser(req, res) {
    if (!agent.activeSimulationId) return null; // no active sim → empty data
    const owned = await getSimulationById(agent.activeSimulationId, req.user.id);
    if (!owned) {
        res.status(404).json({ error: 'Simulation not found' });
        return false;
    }
    return agent.activeSimulationId;
}

app.get('/api/logs', async (req, res) => {
    const simId = await activeSimForUser(req, res);
    if (simId === false || simId === null) return res.json([]);
    const type = req.query.type || 'All';
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    try {
        const logs = await getLogs(limit, offset, type, simId);
        res.json(logs); // Send in DESC order (newest first)
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/portfolio', async (req, res) => {
    const simId = await activeSimForUser(req, res);
    if (simId === false) return;
    if (simId === null) return res.json(null);
    try {
        const stats = await getLatestPortfolio(simId);
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/portfolio/initial', async (req, res) => {
    const simId = await activeSimForUser(req, res);
    if (simId === false) return;
    if (simId === null) return res.json(null);
    try {
        const initial = await getInitialPortfolio(simId);
        res.json(initial);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/portfolio/history', async (req, res) => {
    const simId = await activeSimForUser(req, res);
    if (simId === false) return;
    if (simId === null) return res.json([]);
    try {
        const limit = parseInt(req.query.limit) || 1000;
        const timeRange = req.query.timeRange || 'ALL';
        const history = await getPortfolioHistory(limit, simId, timeRange);
        res.json(history);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Faz 2.5 (B2.5-10) — simulation summary export (CSV): portfolio history +
// decision logs in one downloadable file.
function toCsv(rows) {
    if (!rows || rows.length === 0) return '';
    const headers = Object.keys(rows[0]);
    const escape = v => {
        if (v === null || v === undefined) return '';
        const s = String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [headers.map(escape).join(',')];
    for (const row of rows) {
        lines.push(headers.map(h => escape(row[h])).join(','));
    }
    return lines.join('\n');
}

app.get('/api/simulation/export', async (req, res) => {
    const simId = await activeSimForUser(req, res);
    if (simId === false) return;
    if (simId === null) {
        return res.status(400).json({ error: 'No active simulation to export.' });
    }
    try {
        const history = await getPortfolioHistory(aegisConfig.server.csvExportHistoryLimit, simId, 'ALL');
        const logs = await getLogs(aegisConfig.server.csvExportLogLimit, 0, 'All', simId);
        const portfolioCsv = toCsv(history.map(r => ({
            timestamp: r.timestamp,
            tvl: r.tvl,
            netApy: r.net_apy,
            healthFactor: r.health_factor,
        })));
        const logCsv = toCsv(logs.map(r => ({
            timestamp: r.timestamp,
            type: r.type,
            message: r.message,
            level: r.level,
        })));

        const name = `aegis-sim-${simId}-${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
        res.send(`# Portfolio History\n${portfolioCsv}\n\n# Agent Logs\n${logCsv}`);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/analytics/transactions', async (req, res) => {
    const simId = await activeSimForUser(req, res);
    if (simId === false) return;
    if (simId === null) return res.json([]);
    try {
        const limit = parseInt(req.query.limit) || 100;
        const transactions = await getRecentMemories(limit, simId);
        res.json(transactions);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ---- Backtest endpoints ----
const toInt = (v, def) => { const n = parseInt(v); return isNaN(n) ? def : n; };
const toFloat = (v, def) => { const n = parseFloat(v); return isNaN(n) ? def : n; };

app.get('/api/backtest', async (req, res) => {
    try {
        const result = await Backtester.runBacktest({
            rangeDays: toInt(req.query.rangeDays, 90),
            leverage: toFloat(req.query.leverage, 4),
            gasImpactApy: toFloat(req.query.gasImpactApy, 0.5),
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/backtest/monte-carlo', async (req, res) => {
    try {
        // Cap CPU-heavy simulation counts (unbounded input = DoS vector)
        const simulations = Math.min(Math.max(toInt(req.query.simulations, 500), 1), 2000);
        const days = Math.min(Math.max(toInt(req.query.days, 90), 1), 3650);
        const result = await Backtester.runMonteCarlo({
            meanApy: toFloat(req.query.meanApy, 8),
            sigmaApy: toFloat(req.query.sigmaApy, 10),
            priceVol: toFloat(req.query.priceVol, 0.003),
            days,
            leverage: toFloat(req.query.leverage, 4),
            simulations,
            seed: toInt(req.query.seed, 42),
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/backtest/sweep', async (req, res) => {
    try {
        const leverages = (req.query.leverages || '2,3,4,5,6')
            .split(',')
            .map(n => parseFloat(n.trim()))
            .filter(n => !isNaN(n) && n > 0)
            .slice(0, 20); // cap unbounded user input
        const result = await Backtester.sweep({
            rangeDays: toInt(req.query.rangeDays, 90),
            leverages,
            gasImpactApy: toFloat(req.query.gasImpactApy, 0.5),
        });
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});



// Secrets (OpenRouter key, RPC URL with embedded API keys) are only used
// server-side. The API returns a masked view so an unauthenticated caller can
// never exfiltrate them, even if /api/settings is exposed.
const MASKED_SECRET = '••••••••••••••••';
const EMPTY_SECRETS = new Set(['', 'kullanici_buraya_girecek', MASKED_SECRET]);

function sanitizeSettings(settings) {
    if (!settings) return settings;
    const hasKey = Boolean(settings.openRouterKey) && !EMPTY_SECRETS.has(settings.openRouterKey);
    const hasRpc = Boolean(settings.rpcUrl) && !EMPTY_SECRETS.has(settings.rpcUrl);
    return {
        ...settings,
        openRouterKey: hasKey ? MASKED_SECRET : '',
        rpcUrl: hasRpc ? MASKED_SECRET : '',
        hasOpenRouterKey: hasKey,
        hasRpcUrl: hasRpc,
    };
}

app.get('/api/settings', async (req, res) => {
    try {
        // E9 — settings are per user (open mode: local user).
        const settings = await getSettings(req.user.id);
        res.json(sanitizeSettings(settings));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const settingsSchema = z.object({
    rpcUrl: z.string().optional(),
    slippage: z.union([z.string(), z.number()]).optional(),
    openRouterKey: z.string().optional(),
    activeModel: z.string().optional(),
}).passthrough()
    // B6 — numeric bounds on money-adjacent settings (reject NaN/Infinity/absurd)
    .superRefine((val, ctx) => {
        const num = typeof val.slippage === 'number' ? val.slippage : parseFloat(val.slippage);
        if (val.slippage !== undefined && (Number.isNaN(num) || num < 0 || num > 100)) {
            ctx.addIssue({ code: 'custom', path: ['slippage'], message: 'slippage must be 0–100' });
        }
    });

app.post('/api/settings', async (req, res) => {
    try {
        const settings = settingsSchema.parse(req.body);
        // The settings table appends rows (latest wins). A masked/empty secret
        // on save means "keep the stored value" — carry the current decrypted
        // value into the new row instead of dropping it (which would clear it).
        const current = await getSettings(req.user.id);
        if (settings.openRouterKey === undefined || EMPTY_SECRETS.has(settings.openRouterKey)) {
            settings.openRouterKey = current.openRouterKey || undefined;
        }
        if (settings.rpcUrl === undefined || EMPTY_SECRETS.has(settings.rpcUrl)) {
            settings.rpcUrl = current.rpcUrl || undefined;
        }
        // E9 — only attach the active simulation id when it belongs to this
        // user; otherwise the settings row would point at another user's sim
        // and get wiped when that owner deletes it.
        let simId = null;
        if (agent.activeSimulationId) {
            const owned = await getSimulationById(agent.activeSimulationId, req.user.id);
            simId = owned ? agent.activeSimulationId : null;
        }
        await updateSettings(settings, simId, req.user.id);
        const newSettings = await getSettings(req.user.id);
        res.json({ success: true, settings: sanitizeSettings(newSettings) });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/settings', async (req, res) => {
    try {
        await deleteSettings(req.user.id);
        res.json({ success: true, message: 'Settings cleared' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ---- E9 — Auth + admin routes (exempt from apiKeyMiddleware via the guard
// above; always rate-limited). Extracted to a router factory so isolated
// tests can exercise them without booting the HTTP server.
app.use('/api', createAuthRouter({ clientsByUser, authRequired }));

// Global Error Handler
app.use((err, req, res, _next) => {
    logger.error(`[EXPRESS ERROR] ${err.stack}`);
    res.status(500).json({ error: 'Internal Server Error' });
});

// ---- Start Server ----
const PORT = process.env.PORT || aegisConfig.server.port;

server.listen(PORT, () => {
    logger.info(`🚀 Backend server running on http://localhost:${PORT}`);
    logger.info(`🔌 WebSocket server running on ws://localhost:${PORT}`);
    logger.info(`⏳ Agent is IDLE. Waiting for simulation start...`);
});

// ---- Graceful Shutdown ----
function gracefulShutdown(signal) {
    logger.info(`\n[SYSTEM] ${signal} received. Shutting down gracefully...`);
    agent.stopSimulation();
    agent.stopOracleTicker();

    wss.clients.forEach(client => {
        if (client.readyState === 1) {
            client.send(JSON.stringify({ type: 'server_shutdown', payload: {} }));
            client.close(1001, 'Server shutting down');
        }
    });

    server.close(() => {
        logger.info('[SYSTEM] HTTP server closed.');
        closeDatabase();
        logger.info('[SYSTEM] Cleanup complete. Exiting.');
        process.exit(0);
    });

    setTimeout(() => {
        logger.error('[SYSTEM] Force killing after 10s timeout.');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Clear the WS heartbeat so tests / graceful shutdown don't leak timers
process.on('exit', () => clearInterval(wsHeartbeat));

export { app, server };

