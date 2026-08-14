import { DatabaseSync } from 'node:sqlite';
import crypto from 'crypto';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';
import dotenv from 'dotenv';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Load backend/.env early so ENCRYPTION_KEY is available even when this
// module is imported before server.js runs dotenv.config() (e.g. in tests).
dotenv.config({ path: join(__dirname, '../.env') });
// AEGIS_DB_PATH lets containers keep the database file on a dedicated volume
// instead of inside the source tree (docker-compose mounts it at /app/data).
const DB_PATH = process.env.AEGIS_DB_PATH || join(__dirname, 'aegis.db');

// Ensure directory exists
mkdirSync(dirname(DB_PATH), { recursive: true });

const db = new DatabaseSync(DB_PATH);

// Enable WAL mode and busy timeout for concurrent read/write
db.exec('PRAGMA journal_mode=WAL;');
db.exec('PRAGMA busy_timeout=5000;');
// Enforce foreign key constraints
db.exec('PRAGMA foreign_keys = ON;');

// ---- Create Tables ----
db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        simulation_id INTEGER,
        rpc_url TEXT,
        slippage TEXT,
        openrouter_key TEXT,
        active_model TEXT,
        target_hf REAL,
        max_gas_claim INTEGER,
        automation_rules TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(simulation_id) REFERENCES simulations(id) ON DELETE CASCADE
    );

    -- Add columns if they don't exist (for existing databases)
    -- We can't easily catch errors in a single exec block with multiple statements if one fails,
    -- but SQLite will just ignore the ALTER TABLE if the column exists when using a try-catch in JS.
    `);

try { db.exec('ALTER TABLE settings ADD COLUMN target_hf REAL;'); } catch (e) { }
try { db.exec('ALTER TABLE settings ADD COLUMN max_gas_claim INTEGER;'); } catch (e) { }
try { db.exec('ALTER TABLE settings ADD COLUMN data_mode TEXT;'); } catch (e) { }
try { db.exec('ALTER TABLE settings ADD COLUMN data_scenario TEXT;'); } catch (e) { }
try { db.exec('ALTER TABLE settings ADD COLUMN automation_rules TEXT;'); } catch (e) { }
try { db.exec('ALTER TABLE settings ADD COLUMN llm_tools_enabled INTEGER;'); } catch (e) { }
// E9 — multi-user: owner column on user-facing resources.
try { db.exec('ALTER TABLE settings ADD COLUMN user_id INTEGER;'); } catch (e) { }
// simulations is created AFTER this block (see the big exec below), so the
// ALTER below only serves old databases — fresh ones get user_id from CREATE.
try { db.exec('ALTER TABLE simulations ADD COLUMN user_id INTEGER;'); } catch (e) { }

db.exec(`
    CREATE TABLE IF NOT EXISTS simulations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        status TEXT NOT NULL,
        user_id INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS portfolio_stats(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    simulation_id INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    tvl REAL NOT NULL,
    net_apy REAL NOT NULL,
    health_factor REAL NOT NULL,
    positions_json TEXT,
    oracle_json TEXT,
    FOREIGN KEY(simulation_id) REFERENCES simulations(id) ON DELETE CASCADE
);

    CREATE TABLE IF NOT EXISTS agent_logs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    simulation_id INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    level TEXT NOT NULL,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    metadata_json TEXT,
    FOREIGN KEY(simulation_id) REFERENCES simulations(id) ON DELETE CASCADE
);

    CREATE TABLE IF NOT EXISTS decision_memory(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    simulation_id INTEGER,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    market_state_json TEXT NOT NULL,
    action_taken TEXT NOT NULL,
    is_successful BOOLEAN,
    profit_loss REAL,
    details_json TEXT,
    FOREIGN KEY(simulation_id) REFERENCES simulations(id) ON DELETE CASCADE
);

    -- Historical market data snapshots (independent of simulations) used for
    -- backtesting and trend analysis. Stored as JSON payloads keyed by source+symbol.
    CREATE TABLE IF NOT EXISTS market_history(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT NOT NULL,
    symbol TEXT NOT NULL,
    payload_json TEXT NOT NULL
);

    -- E9 — accounts. The FIRST registered user becomes admin; subsequent
    -- registrations get role 'user'. 'local' is the seeded single-user-mode
    -- identity (open mode / AUTH_REQUIRED=false) and the backfill owner of
    -- all pre-E9 rows.
    CREATE TABLE IF NOT EXISTS users(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    role TEXT NOT NULL DEFAULT 'user',
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

    CREATE TABLE IF NOT EXISTS sessions(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash TEXT NOT NULL UNIQUE,
    user_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

// E9 — indexes for per-user lookups + prune.
db.exec('CREATE INDEX IF NOT EXISTS idx_simulations_user ON simulations(user_id);');
db.exec('CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_id);');
db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);');

// ---- E9 — local (legacy) user: the identity used in open mode and the owner
// of every pre-E9 row. Seeded once; never deletable through the API.
export function getLocalUserId() {
    let row = db.prepare('SELECT id FROM users WHERE username = ?').get('local');
    if (!row) {
        const info = db.prepare('INSERT INTO users(username, role) VALUES(?, ?)').run('local', 'admin');
        return Number(info.lastInsertRowid);
    }
    return Number(row.id);
}

// ---- E9 — backfill: claim every pre-E9 row for the local user (idempotent).
function backfillUserOwnership() {
    const localId = getLocalUserId();
    db.prepare('UPDATE simulations SET user_id = ? WHERE user_id IS NULL').run(localId);
    // Settings written for a simulation inherit that simulation's owner;
    // global rows (simulation_id NULL) belong to the local user.
    db.prepare(`
        UPDATE settings SET user_id = COALESCE(
            (SELECT user_id FROM simulations WHERE simulations.id = settings.simulation_id),
            ?
        ) WHERE user_id IS NULL
    `).run(localId);
}
backfillUserOwnership();

// ---- Helper Functions (Sync wrappers for sqlite3) ----
export function insertLog(level, type, message, metadata = null, simulationId = null) {
    const stmt = db.prepare('INSERT INTO agent_logs (level, type, message, metadata_json, simulation_id) VALUES (?, ?, ?, ?, ?)');
    stmt.run(level, type, message, metadata ? JSON.stringify(metadata) : null, simulationId);
}

export async function getLogs(limit = 100, offset = 0, type = 'All', simulationId = null) {
    let query = 'SELECT * FROM agent_logs WHERE 1=1';
    const params = [];

    if (simulationId) {
        query += ' AND simulation_id = ?';
        params.push(simulationId);
    }

    if (type !== 'All') {
        query += ' AND type = ?';
        params.push(type);
    }

    query += ' ORDER BY id DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    return db.prepare(query).all(...params);
}

export function insertPortfolioStats(tvl, netApy, healthFactor, positions, oracle, simulationId = null) {
    const stmt = db.prepare('INSERT INTO portfolio_stats (tvl, net_apy, health_factor, positions_json, oracle_json, simulation_id) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(tvl, netApy, healthFactor, JSON.stringify(positions), JSON.stringify(oracle), simulationId);
}

export async function getPortfolioHistory(limit = 50, simulationId = null, timeRange = null) {
    let query = 'SELECT * FROM portfolio_stats';
    const params = [];
    const conditions = [];

    if (simulationId) {
        conditions.push('simulation_id = ?');
        params.push(simulationId);
    }

    if (timeRange && timeRange !== 'ALL') {
        let hours = 24;
        if (timeRange === '1H') hours = 1;
        else if (timeRange === '7D') hours = 24 * 7;

        const pastDate = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
        conditions.push('timestamp >= ?');
        params.push(pastDate);
    }

    if (conditions.length > 0) {
        query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);

    return db.prepare(query).all(...params);
}

export async function getLatestPortfolio(simulationId = null) {
    let row;
    if (simulationId) {
        row = db.prepare('SELECT * FROM portfolio_stats WHERE simulation_id = ? ORDER BY id DESC LIMIT 1').get(simulationId);
    } else {
        row = db.prepare('SELECT * FROM portfolio_stats ORDER BY id DESC LIMIT 1').get();
    }
    if (row) {
        return {
            id: row.id,
            timestamp: row.timestamp,
            tvl: row.tvl,
            netApy: row.net_apy,
            healthFactor: row.health_factor,
            positions: row.positions_json ? JSON.parse(row.positions_json) : null,
            oracle: row.oracle_json ? JSON.parse(row.oracle_json) : null,
        };
    } else {
        return {
            tvl: 0,
            netApy: 0,
            healthFactor: 0,
            positions: null,
            oracle: null
        };
    }
}

export async function getInitialPortfolio(simulationId = null) {
    let row;
    if (simulationId) {
        row = db.prepare('SELECT * FROM portfolio_stats WHERE simulation_id = ? ORDER BY id ASC LIMIT 1').get(simulationId);
    } else {
        row = db.prepare('SELECT * FROM portfolio_stats ORDER BY id ASC LIMIT 1').get();
    }

    if (row) {
        return {
            id: row.id,
            timestamp: row.timestamp,
            tvl: row.tvl,
            netApy: row.net_apy,
            healthFactor: row.health_factor,
        };
    } else {
        return null;
    }
}

export function checkSimulationNameExists(name, userId) {
    requireUserId(userId, 'checkSimulationNameExists');
    const row = db.prepare('SELECT id FROM simulations WHERE name = ? AND user_id = ?').get(name, userId);
    return !!row;
}

export function generateUniqueSimulationName(baseName, userId) {
    let newName = baseName;
    let counter = 1;
    while (checkSimulationNameExists(newName, userId)) {
        newName = `${baseName} (${counter})`;
        counter++;
    }
    return newName;
}

export async function resetPortfolio(initialBalance, simulationName = 'Default Simulation', simulationIdToReset = null, userId) {
    requireUserId(userId, 'resetPortfolio');
    if (simulationIdToReset) {
        // E9 — ownership enforced in the DELETE itself (composite key).
        db.prepare(`DELETE FROM settings WHERE simulation_id = ? AND user_id = ?`).run(simulationIdToReset, userId);
        db.prepare(`DELETE FROM portfolio_stats WHERE simulation_id = ? `).run(simulationIdToReset);
        db.prepare(`DELETE FROM agent_logs WHERE simulation_id = ? `).run(simulationIdToReset);
        db.prepare(`DELETE FROM decision_memory WHERE simulation_id = ? `).run(simulationIdToReset);

        const stmt = db.prepare(`INSERT INTO portfolio_stats(tvl, net_apy, health_factor, simulation_id) VALUES(?, ?, ?, ?)`);
        const info = stmt.run(initialBalance, 0, 1.5, simulationIdToReset);
        return { id: info.lastInsertRowid, tvl: initialBalance, netApy: 0, healthFactor: 1.5, simulationId: simulationIdToReset };
    }

    // Cleanup: Keep only the 5 most recent simulations of THIS user to prevent DB bloat
    const simulationsToKeep = db.prepare(`SELECT id FROM simulations WHERE user_id = ? ORDER BY id DESC LIMIT 5`).all(userId).map(row => row.id);

    if (simulationsToKeep.length > 0) {
        const keepIds = simulationsToKeep.join(',');
        // Children are scoped via their parent simulation — only THIS user's
        // sims outside the keep-list are pruned (never another user's rows).
        db.prepare(`DELETE FROM settings WHERE user_id = ? AND simulation_id NOT IN(${keepIds})`).run(userId);
        db.prepare(`DELETE FROM portfolio_stats WHERE simulation_id IN (SELECT id FROM simulations WHERE user_id = ?) AND simulation_id NOT IN(${keepIds})`).run(userId);
        db.prepare(`DELETE FROM agent_logs WHERE simulation_id IN (SELECT id FROM simulations WHERE user_id = ?) AND simulation_id NOT IN(${keepIds})`).run(userId);
        db.prepare(`DELETE FROM decision_memory WHERE simulation_id IN (SELECT id FROM simulations WHERE user_id = ?) AND simulation_id NOT IN(${keepIds})`).run(userId);
        db.prepare(`DELETE FROM simulations WHERE user_id = ? AND id NOT IN(${keepIds})`).run(userId);
    } else {
        db.prepare(`DELETE FROM settings WHERE user_id = ?`).run(userId);
        db.prepare(`DELETE FROM portfolio_stats WHERE simulation_id IN (SELECT id FROM simulations WHERE user_id = ?)`).run(userId);
        db.prepare(`DELETE FROM agent_logs WHERE simulation_id IN (SELECT id FROM simulations WHERE user_id = ?)`).run(userId);
        db.prepare(`DELETE FROM decision_memory WHERE simulation_id IN (SELECT id FROM simulations WHERE user_id = ?)`).run(userId);
        db.prepare(`DELETE FROM simulations WHERE user_id = ?`).run(userId);
    }

    // Create a new simulation record instead of deleting old ones
    const simStmt = db.prepare(`INSERT INTO simulations(name, status, user_id) VALUES(?, 'ACTIVE', ?)`);
    const simInfo = simStmt.run(simulationName, userId);
    const simulationId = simInfo.lastInsertRowid;

    const stmt = db.prepare(`INSERT INTO portfolio_stats(tvl, net_apy, health_factor, simulation_id) VALUES(?, ?, ?, ?)`);
    const info = stmt.run(initialBalance, 0, 1.5, simulationId);

    return { id: info.lastInsertRowid, tvl: initialBalance, netApy: 0, healthFactor: 1.5, simulationId };
}

export function insertMemory(marketState, actionTaken, isSuccessful, profitLoss = 0, simulationId = null, details = null) {
    const stmt = db.prepare('INSERT INTO decision_memory (market_state_json, action_taken, is_successful, profit_loss, simulation_id, details_json) VALUES (?, ?, ?, ?, ?, ?)');
    stmt.run(JSON.stringify(marketState), actionTaken, isSuccessful ? 1 : 0, profitLoss, simulationId, details ? JSON.stringify(details) : null);
}

export async function getRecentMemories(limit = 5, simulationId = null) {
    if (simulationId) {
        return db.prepare('SELECT * FROM decision_memory WHERE simulation_id = ? ORDER BY id DESC LIMIT ?').all(simulationId, limit);
    }
    return db.prepare('SELECT * FROM decision_memory ORDER BY id DESC LIMIT ?').all(limit);
}

// ---- Market History (backtesting / trend analysis) ----
export function recordMarketHistory(source, symbol, payload) {
    const stmt = db.prepare('INSERT INTO market_history (source, symbol, payload_json) VALUES (?, ?, ?)');
    stmt.run(source, symbol, typeof payload === 'string' ? payload : JSON.stringify(payload));
}

export async function getMarketHistory(source, symbol, limit = 1000, fromTs = null, toTs = null) {
    let query = 'SELECT * FROM market_history WHERE source = ? AND symbol = ?';
    const params = [source, symbol];
    if (fromTs) {
        query += ' AND timestamp >= ?';
        params.push(fromTs);
    }
    if (toTs) {
        query += ' AND timestamp <= ?';
        params.push(toTs);
    }
    query += ' ORDER BY id DESC LIMIT ?';
    params.push(limit);
    return db.prepare(query).all(...params);
}

export async function getLatestMarketHistory(source, symbol) {
    return db.prepare('SELECT * FROM market_history WHERE source = ? AND symbol = ? ORDER BY id DESC LIMIT 1').get(source, symbol);
}

export function clearMarketHistory(source = null, symbol = null) {
    if (source && symbol) {
        db.prepare('DELETE FROM market_history WHERE source = ? AND symbol = ?').run(source, symbol);
    } else if (source) {
        db.prepare('DELETE FROM market_history WHERE source = ?').run(source);
    } else {
        db.prepare('DELETE FROM market_history').run();
    }
}

export async function getActiveSimulation(userId) {
    requireUserId(userId, 'getActiveSimulation');
    return db.prepare('SELECT * FROM simulations WHERE status = ? AND user_id = ? ORDER BY id DESC LIMIT 1').get('ACTIVE', userId);
}

export async function getLatestSimulation(userId) {
    requireUserId(userId, 'getLatestSimulation');
    return db.prepare('SELECT * FROM simulations WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);
}

export async function getAllSimulations(userId) {
    requireUserId(userId, 'getAllSimulations');
    return db.prepare('SELECT * FROM simulations WHERE user_id = ? ORDER BY id DESC').all(userId);
}

export async function getSimulationById(id, userId) {
    requireUserId(userId, 'getSimulationById');
    return db.prepare('SELECT * FROM simulations WHERE id = ? AND user_id = ?').get(id, userId);
}

export async function stopSimulation(simulationId, userId) {
    requireUserId(userId, 'stopSimulation');
    db.prepare('UPDATE simulations SET status = ? WHERE id = ? AND user_id = ?').run('STOPPED', simulationId, userId);
}

export async function setSimulationStatus(simulationId, status, userId) {
    requireUserId(userId, 'setSimulationStatus');
    db.prepare('UPDATE simulations SET status = ? WHERE id = ? AND user_id = ?').run(status, simulationId, userId);
}

export async function deleteSimulation(id, userId) {
    requireUserId(userId, 'deleteSimulation');
    // Ownership enforced in the WHERE clause: another user's simulation is
    // untouched and reports false → API answers 404 (no existence leak).
    const owned = db.prepare('SELECT id FROM simulations WHERE id = ? AND user_id = ?').get(id, userId);
    if (!owned) return false;
    // Manually delete child records to support older databases that might not have ON DELETE CASCADE
    // E9 — settings cleanup is user-scoped so another user's row (which can
    // never legitimately point at this sim, but belt-and-braces) survives.
    db.prepare('DELETE FROM settings WHERE simulation_id = ? AND user_id = ?').run(id, userId);
    db.prepare('DELETE FROM portfolio_stats WHERE simulation_id = ?').run(id);
    db.prepare('DELETE FROM agent_logs WHERE simulation_id = ?').run(id);
    db.prepare('DELETE FROM decision_memory WHERE simulation_id = ?').run(id);
    db.prepare('DELETE FROM simulations WHERE id = ?').run(id);
    return true;
}

let ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY) {
    logger.error('[FATAL ERROR] ENCRYPTION_KEY is missing. Set it in backend/.env to protect stored API keys.');
    logger.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
    process.exit(1);
}

let encryptionKeyBuffer = Buffer.from(ENCRYPTION_KEY);
if (encryptionKeyBuffer.length !== 32) {
    if (process.env.NODE_ENV === 'production') {
        // B5 — a padded AES-128 key is a real weakness; refuse to run in prod.
        logger.error('[FATAL ERROR] ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars) in production.');
        logger.error('Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
        process.exit(1);
    }
    logger.warn('[WARNING] ENCRYPTION_KEY is not 32 bytes. Truncating/padding to 32 bytes (dev only).');
    if (encryptionKeyBuffer.length > 32) {
        encryptionKeyBuffer = encryptionKeyBuffer.slice(0, 32);
    } else {
        const padded = Buffer.alloc(32, 0);
        encryptionKeyBuffer.copy(padded);
        encryptionKeyBuffer = padded;
    }
}
const IV_LENGTH = 16;

// Exported for unit tests (B5) — the production callers use updateSettings.
export function encrypt(text) {
    if (!text) return text;
    try {
        let iv = crypto.randomBytes(IV_LENGTH);
        let cipher = crypto.createCipheriv('aes-256-cbc', encryptionKeyBuffer, iv);
        let encrypted = cipher.update(text);
        encrypted = Buffer.concat([encrypted, cipher.final()]);
        return iv.toString('hex') + ':' + encrypted.toString('hex');
    } catch (e) {
        // B5 — never persist a secret in plaintext: on cipher failure the value
        // is NOT stored (null) instead of silently saving the raw key.
        logger.error(`Encryption failed, value NOT stored: ${e.message}`);
        return null;
    }
}

export function decrypt(text) {
    if (!text) return text;
    try {
        let textParts = text.split(':');
        if (textParts.length !== 2) return text; // Not encrypted or wrong format
        let iv = Buffer.from(textParts[0], 'hex');
        let encryptedText = Buffer.from(textParts[1], 'hex');
        let decipher = crypto.createDecipheriv('aes-256-cbc', encryptionKeyBuffer, iv);
        let decrypted = decipher.update(encryptedText);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        return decrypted.toString();
    } catch (e) {
        return text;
    }
}

function parseAutomationRules(raw) {
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

export async function getSettings(userId) {
    requireUserId(userId, 'getSettings');
    // E9 — per-user latest row (append-log model stays per user).
    const row = db.prepare('SELECT * FROM settings WHERE user_id = ? ORDER BY id DESC LIMIT 1').get(userId);
    if (row) {
        return {
            rpcUrl: decrypt(row.rpc_url) || process.env.EVM_PROVIDER_URL || '',
            slippage: row.slippage || '0.5',
            openRouterKey: decrypt(row.openrouter_key) || process.env.OPENROUTER_API_KEY || '',
            activeModel: row.active_model || 'meta-llama/llama-3.1-70b-instruct',
            targetHf: row.target_hf != null ? row.target_hf : 1.25,
            maxGasClaim: row.max_gas_claim != null ? row.max_gas_claim : 20,
            dataMode: row.data_mode || 'LIVE',
            dataScenario: row.data_scenario || 'stable',
            automationRules: parseAutomationRules(row.automation_rules),
            llmToolsEnabled: row.llm_tools_enabled != null ? row.llm_tools_enabled === 1 : true
        };
    } else {
        return {
            rpcUrl: process.env.EVM_PROVIDER_URL || '',
            slippage: '0.5',
            openRouterKey: process.env.OPENROUTER_API_KEY || '',
            activeModel: 'meta-llama/llama-3.1-70b-instruct',
            targetHf: 1.25,
            maxGasClaim: 20,
            dataMode: 'LIVE',
            dataScenario: 'stable',
            automationRules: [],
            llmToolsEnabled: true
        };
    }
}

export async function updateSettings(settings, simulationId = null, userId) {
    requireUserId(userId, 'updateSettings');
    const stmt = db.prepare(`
      INSERT INTO settings(simulation_id, user_id, rpc_url, slippage, openrouter_key, active_model, target_hf, max_gas_claim, data_mode, data_scenario, automation_rules, llm_tools_enabled)
VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
        simulationId,
        userId,
        encrypt(settings.rpcUrl) ?? null,
        settings.slippage ?? null,
        encrypt(settings.openRouterKey) ?? null,
        settings.activeModel ?? null,
        settings.targetHf ?? 1.25,
        settings.maxGasClaim ?? 20,
        settings.dataMode ?? 'LIVE',
        settings.dataScenario ?? 'stable',
        Array.isArray(settings.automationRules)
            ? JSON.stringify(settings.automationRules)
            : null,
        settings.llmToolsEnabled != null ? (settings.llmToolsEnabled ? 1 : 0) : null
    );
}

export async function deleteSettings(userId) {
    requireUserId(userId, 'deleteSettings');
    db.prepare('DELETE FROM settings WHERE user_id = ?').run(userId);
}

// ---- E9 — users / sessions (server-side auth, see utils/auth.js) ----

export function requireUserId(userId, fnName) {
    if (userId === undefined || userId === null) {
        throw new Error(`${fnName}: userId is required (E9 — per-user data isolation)`);
    }
}

export function countUsers() {
    // E9 — the seeded 'local' user must not count: the FIRST real registration
    // becomes admin (bootstrap), regardless of the local seed.
    return Number(db.prepare("SELECT COUNT(*) AS c FROM users WHERE username != 'local'").get().c);
}

export function createUser(username, passwordHash, role = 'user') {
    const info = db.prepare('INSERT INTO users(username, password_hash, role) VALUES(?, ?, ?)').run(username, passwordHash, role);
    return Number(info.lastInsertRowid);
}

export function getUserByUsername(username) {
    return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
}

export function getUserById(id) {
    return db.prepare('SELECT id, username, role, failed_attempts, locked_until, created_at FROM users WHERE id = ?').get(id);
}

export function getAllUsers() {
    return db.prepare('SELECT id, username, role, created_at FROM users WHERE username != ? ORDER BY id ASC').all('local');
}

export function incrementFailedAttempts(id) {
    // OWASP — lockout is per-account, not per-IP. 5 failures → 15 minutes.
    db.prepare('UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?').run(id);
    const row = db.prepare('SELECT failed_attempts FROM users WHERE id = ?').get(id);
    if (row && Number(row.failed_attempts) >= 5) {
        db.prepare('UPDATE users SET locked_until = ? WHERE id = ?')
            .run(new Date(Date.now() + 15 * 60 * 1000).toISOString(), id);
    }
}

export function clearFailedAttempts(id) {
    db.prepare('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?').run(id);
}

export function deleteUserById(id) {
    db.prepare('DELETE FROM users WHERE id = ?').run(id);
}

const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS) || 30;

export function createSession(userId, ttlDays = SESSION_TTL_DAYS) {
    requireUserId(userId, 'createSession');
    const token = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('INSERT INTO sessions(token_hash, user_id, expires_at) VALUES(?, ?, ?)').run(tokenHash, userId, expiresAt);
    return { token, expiresAt, ttlDays };
}

export function getSessionUser(token) {
    if (!token) return null;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const row = db.prepare(`
        SELECT u.id, u.username, u.role, s.expires_at
        FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?
    `).get(tokenHash);
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
        return null;
    }
    return { id: Number(row.id), username: row.username, role: row.role };
}

export function deleteSession(token) {
    if (!token) return;
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function deleteSessionsByUser(userId) {
    requireUserId(userId, 'deleteSessionsByUser');
    db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

export function cleanupExpiredSessions() {
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
}
cleanupExpiredSessions();

export function closeDatabase() {
    try {
        db.close();
        logger.info('[DATABASE] SQLite connection closed gracefully.');
    } catch (err) {
        logger.error(`[DATABASE] Error closing SQLite connection: ${err.message} `);
    }
}

export default db;
