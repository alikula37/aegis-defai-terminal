import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { getLogs, getLatestPortfolio, getInitialPortfolio, getPortfolioHistory, getSettings, updateSettings, deleteSettings, getRecentMemories, closeDatabase, checkSimulationNameExists, generateUniqueSimulationName, getLatestSimulation, setSimulationStatus, getAllSimulations, deleteSimulation } from './db/database.js';
import { AegisAgent } from './agent.js';
import { Backtester } from './backtest/Backtester.js';
import helmet from 'helmet';
import { z } from 'zod';
import logger from './utils/logger.js';
import { validateWsSubprotocol, expectedWsKey } from './utils/wsAuth.js';
import { createMetrics } from './monitoring/metrics.js';
import { initTracing } from './monitoring/tracing.js';
import { apiKeyMiddleware } from './utils/apiAuth.js';
import { createRateLimiter } from './utils/rateLimit.js';

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
    }
}));

app.use(helmet());

const apiLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: Number(process.env.RATE_LIMIT_API_MAX) || 300, // per IP
});
app.use('/api/', apiLimiter);

// Stricter ceiling on state-changing endpoints (B6) — brute-force / abuse guard.
const writeLimiter = createRateLimiter({
    windowMs: 15 * 60 * 1000,
    max: Number(process.env.RATE_LIMIT_WRITE_MAX) || 50,
});
app.use('/api/', (req, res, next) => {
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) return writeLimiter(req, res, next);
    return next();
});

// ---- Optional API key auth (B2.5-2) ----
// Enabled by setting AEGIS_API_KEY. When set, every /api request must carry
// `x-api-key: <AEGIS_API_KEY>`. When unset the API stays open (local dev).
// In production writes fail closed. (Middleware lives in utils/apiAuth.js so
// it can be unit-tested without booting the HTTP server.)
app.use('/api/', apiKeyMiddleware);

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
const clients = new Set();

// Faz 2.5 (B2.5-11) — heartbeat: ping idle clients every 30s and drop dead
// ones so the client gauge and the connection pool stay accurate.
const WS_HEARTBEAT_INTERVAL_MS = 30000;
const wsHeartbeat = setInterval(() => {
    for (const ws of clients) {
        if (ws.isAlive === false) {
            clients.delete(ws);
            ws.terminate();
            continue;
        }
        ws.isAlive = false;
        try {
            ws.ping();
        } catch {
            clients.delete(ws);
        }
    }
    metrics.wsClients.set(clients.size);
}, WS_HEARTBEAT_INTERVAL_MS);

wss.on('connection', async (ws, _req) => {
    // Subprotocol auth handled at handshake time via `handleProtocols`.
    clients.add(ws);
    metrics.wsClients.set(clients.size);
    logger.info('New WebSocket client connected');
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    // Send the latest portfolio from DB immediately on connect
    try {
        const portfolio = await getLatestPortfolio();
        ws.send(JSON.stringify({
            type: 'portfolio_update',
            payload: portfolio
        }));
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
        clients.delete(ws);
        metrics.wsClients.set(clients.size);
        logger.info('WebSocket client disconnected');
    });
});

function broadcast(type, payload) {
    const message = JSON.stringify({ type, payload });
    for (const client of clients) {
        if (client.readyState === 1) { // OPEN
            try {
                client.send(message);
            } catch (err) {
                // A half-closed / dead client must never abort the broadcast
                // loop for the other clients.
                clients.delete(client);
                logger.debug(`WS broadcast to dead client dropped: ${err.message}`);
            }
        }
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
    res.json({ status: 'ok', uptime: process.uptime(), wsClients: clients.size });
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
        if (Number.isNaN(num) || num <= 0 || num > 1e12) {
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
            ? Math.min(rawBalance, 1e12)
            : 10000;
        const simulationName = settings.simulationName || 'Default Simulation';

        if (!settings.isResume) {
            if (checkSimulationNameExists(simulationName)) {
                const suggestedName = generateUniqueSimulationName(simulationName);
                return res.status(400).json({
                    error: 'Simulation name already exists.',
                    suggestedName
                });
            }
        }

        await agent.startSimulation(initialBalance, settings, simulationName);
        metrics.agentRunning.set(1);
        res.json({ success: true, message: 'Simulation started', initialBalance, simulationName });
    } catch (error) {
        if (error instanceof z.ZodError) {
            return res.status(400).json({ error: error.errors });
        }
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/simulation/stop', (req, res) => {
    try {
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
            const simulations = await getAllSimulations();
            simToResume = simulations.find(s => s.id === parseInt(simulationId));
        } else {
            simToResume = await getLatestSimulation();
        }

        if (!simToResume) {
            return res.status(400).json({ error: 'No simulation to resume' });
        }

        agent.activeSimulationId = simToResume.id;

        const latestPortfolio = await getLatestPortfolio(agent.activeSimulationId);
        const initialBalance = latestPortfolio ? latestPortfolio.tvl : 10000;
        const simulationName = simToResume.name;

        const settings = await getSettings();

        await setSimulationStatus(simToResume.id, 'ACTIVE');

        await agent.startSimulation(initialBalance, { ...settings, isResume: true }, simulationName);
        res.json({ success: true, message: 'Simulation resumed', initialBalance, simulationName });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/simulations', async (req, res) => {
    try {
        const simulations = await getAllSimulations();
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

        if (agent.activeSimulationId === id) {
            agent.stopSimulation();
            agent.activeSimulationId = null;
        }

        await deleteSimulation(id);
        res.json({ success: true, message: 'Simulation deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/simulation/reset', async (req, res) => {
    try {
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

app.get('/api/logs', async (req, res) => {
    if (!agent.activeSimulationId) return res.json([]);
    const type = req.query.type || 'All';
    const limit = parseInt(req.query.limit) || 100;
    const offset = parseInt(req.query.offset) || 0;

    try {
        const logs = await getLogs(limit, offset, type, agent.activeSimulationId);
        res.json(logs); // Send in DESC order (newest first)
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/portfolio', async (req, res) => {
    if (!agent.activeSimulationId) return res.json(null);
    try {
        const stats = await getLatestPortfolio(agent.activeSimulationId);
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/portfolio/initial', async (req, res) => {
    if (!agent.activeSimulationId) return res.json(null);
    try {
        const initial = await getInitialPortfolio(agent.activeSimulationId);
        res.json(initial);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/portfolio/history', async (req, res) => {
    if (!agent.activeSimulationId) return res.json([]);
    try {
        const limit = parseInt(req.query.limit) || 1000;
        const timeRange = req.query.timeRange || 'ALL';
        const history = await getPortfolioHistory(limit, agent.activeSimulationId, timeRange);
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
    if (!agent.activeSimulationId) {
        return res.status(400).json({ error: 'No active simulation to export.' });
    }
    try {
        const history = await getPortfolioHistory(10000, agent.activeSimulationId, 'ALL');
        const logs = await getLogs(2000, 0, 'All', agent.activeSimulationId);
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

        const name = `aegis-sim-${agent.activeSimulationId}-${Date.now()}.csv`;
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
        res.send(`# Portfolio History\n${portfolioCsv}\n\n# Agent Logs\n${logCsv}`);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/analytics/transactions', async (req, res) => {
    if (!agent.activeSimulationId) return res.json([]);
    try {
        const limit = parseInt(req.query.limit) || 100;
        const transactions = await getRecentMemories(limit, agent.activeSimulationId);
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
        const settings = await getSettings();
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
        const current = await getSettings();
        if (settings.openRouterKey === undefined || EMPTY_SECRETS.has(settings.openRouterKey)) {
            settings.openRouterKey = current.openRouterKey || undefined;
        }
        if (settings.rpcUrl === undefined || EMPTY_SECRETS.has(settings.rpcUrl)) {
            settings.rpcUrl = current.rpcUrl || undefined;
        }
        await updateSettings(settings, agent.activeSimulationId);
        const newSettings = await getSettings();
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
        await deleteSettings();
        res.json({ success: true, message: 'Settings cleared' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Global Error Handler
app.use((err, req, res, _next) => {
    logger.error(`[EXPRESS ERROR] ${err.stack}`);
    res.status(500).json({ error: 'Internal Server Error' });
});

// ---- Start Server ----
const PORT = process.env.PORT || 3001;

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

