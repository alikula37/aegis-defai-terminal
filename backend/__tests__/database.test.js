import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import db, {
    insertLog, getLogs, insertPortfolioStats, getLatestPortfolio, resetPortfolio,
    updateSettings, getSettings, encrypt, decrypt,
    getLocalUserId, createUser, getUserByUsername, getUserById, countUsers,
    createSession, getSessionUser, deleteSession, incrementFailedAttempts, clearFailedAttempts,
    deleteUserById, getAllSimulations, getSimulationById, getAllUsers,
} from '../db/database.js';
import crypto from 'crypto';

// E9 — every user-scoped query needs an explicit owner; tests use the local
// (open-mode) identity for backward-compatible behavior.
const USER = () => getLocalUserId();

describe('Database Operations', () => {
    beforeEach(async () => {
        // Reset DB before each test
        await resetPortfolio(10000, 'Default Simulation', null, USER());
    });

    afterAll(() => {
        db.close();
    });

    // ---- B5: secret encryption hardening ----

    it('encrypts secrets to iv:ciphertext and decrypts round-trip', () => {
        const ct = encrypt('sk-super-secret');
        expect(typeof ct).toBe('string');
        expect(ct).not.toBe('sk-super-secret');
        expect(ct.split(':').length).toBe(2);
        expect(decrypt(ct)).toBe('sk-super-secret');
    });

    it('returns empty values untouched (no plaintext persistence for falsy)', () => {
        expect(encrypt('')).toBe('');
        expect(encrypt(null)).toBeNull();
        expect(decrypt('')).toBe('');
    });

    it('NEVER persists a secret in plaintext when encryption fails (B5)', () => {
        const spy = vi.spyOn(crypto, 'randomBytes').mockImplementationOnce(() => {
            throw new Error('no entropy');
        });
        const ct = encrypt('sk-must-not-leak');
        spy.mockRestore();
        expect(ct).toBeNull();
        expect(ct).not.toBe('sk-must-not-leak');
    });

    it('should insert and retrieve logs', async () => {
        insertLog('info', 'system', 'Test log message', { test: true });
        const logs = await getLogs(10);
        expect(logs.length).toBeGreaterThan(0);
        expect(logs[0].message).toBe('Test log message');
        expect(logs[0].type).toBe('system');
    });

    it('should insert and retrieve portfolio stats', async () => {
        insertPortfolioStats(15000, 10.5, 1.4, [{ name: 'Test Strategy' }], { ethPrice: 3000 });
        const latest = await getLatestPortfolio();
        expect(latest.tvl).toBe(15000);
        expect(latest.netApy).toBe(10.5);
        expect(latest.healthFactor).toBe(1.4);
        expect(latest.positions[0].name).toBe('Test Strategy');
        expect(latest.oracle.ethPrice).toBe(3000);
    });

    it('should reset portfolio correctly', async () => {
        await resetPortfolio(5000, 'Default Simulation', null, USER());
        const latest = await getLatestPortfolio();
        expect(latest.tvl).toBe(5000);
        expect(latest.netApy).toBe(0);
        expect(latest.healthFactor).toBe(1.5);
    });

    it('should persist automation rules and data mode', async () => {
        await updateSettings({
            rpcUrl: '',
            slippage: '0.5',
            openRouterKey: '',
            activeModel: 'test-model',
            targetHf: 1.3,
            maxGasClaim: 15,
            dataMode: 'SIM',
            dataScenario: 'bull',
            automationRules: [
                { id: 'r1', condition: 'HF < 1.2', action: 'Rebalance', enabled: true },
                { id: 'r2', condition: 'Gas < 15 gwei', action: 'Claim Rewards', enabled: false },
            ],
        }, null, USER());
        const s = await getSettings(USER());
        expect(s.dataMode).toBe('SIM');
        expect(s.dataScenario).toBe('bull');
        expect(s.automationRules).toHaveLength(2);
        expect(s.automationRules[0].action).toBe('Rebalance');
        expect(s.automationRules[1].enabled).toBe(false);
    });

    it('should default automation rules to empty array', async () => {
        await updateSettings({ rpcUrl: '', slippage: '0.5' }, null, USER());
        const s = await getSettings(USER());
        expect(Array.isArray(s.automationRules)).toBe(true);
        expect(s.automationRules).toHaveLength(0);
    });

    // ---- E9: users / sessions / isolation ----

    it('getSettings requires an explicit userId (E9)', async () => {
        await expect(getSettings()).rejects.toThrow(/userId is required/);
        await expect(getSettings(null)).rejects.toThrow(/userId is required/);
    });

    it('creates and verifies sessions with expiry', async () => {
        const username = `alice_${Date.now()}`;
        const uid = createUser(username, 'hash', 'user');
        const { token } = createSession(uid);
        const session = getSessionUser(token);
        expect(session).not.toBeNull();
        expect(session.id).toBe(uid);
        expect(session.username).toBe(username);
        expect(session.role).toBe('user');
        deleteSession(token);
        expect(getSessionUser(token)).toBeNull();
    });

    it('rejects expired sessions', () => {
        const uid = createUser(`bob_${Date.now()}`, 'hash', 'user');
        const { token } = createSession(uid, -1); // already expired
        expect(getSessionUser(token)).toBeNull();
    });

    it('counts users and reports lockout state (E9 brute-force)', () => {
        const before = countUsers();
        const username = `mallory_${Date.now()}`;
        const uid = createUser(username, 'hash', 'user');
        expect(countUsers()).toBe(before + 1);
        expect(getUserByUsername(username).role).toBe('user');
        for (let i = 0; i < 5; i++) incrementFailedAttempts(uid);
        const locked = getUserById(uid);
        expect(Number(locked.failed_attempts)).toBe(5);
        expect(locked.locked_until).not.toBeNull();
        clearFailedAttempts(uid);
        expect(Number(getUserById(uid).failed_attempts)).toBe(0);
        expect(getUserById(uid).locked_until).toBeNull();
    });

    it('isolates simulations per user and hides other users rows (E9)', async () => {
        const uidA = createUser(`owner_a_${Date.now()}`, 'hash', 'user');
        const uidB = createUser(`owner_b_${Date.now()}`, 'hash', 'user');
        await resetPortfolio(1000, 'A Run', null, uidA);
        const simsA = await getAllSimulations(uidA);
        expect(simsA.length).toBeGreaterThan(0);
        const simA = simsA[0];
        // B cannot see or fetch A's simulation by id (404 semantics)
        expect((await getAllSimulations(uidB)).find(s => s.id === simA.id)).toBeUndefined();
        expect(await getSimulationById(simA.id, uidB)).toBeUndefined();
        expect(await getSimulationById(simA.id, uidA)).toBeDefined();
        // B's own simulations are untouched by A's prune
        await resetPortfolio(2000, 'B Run', null, uidB);
        expect((await getAllSimulations(uidB)).some(s => s.name === 'B Run')).toBe(true);
        expect((await getAllSimulations(uidA)).some(s => s.name === 'A Run')).toBe(true);
    });

    it('scopes settings by user (E9)', async () => {
        const uidA = createUser(`s_alice_${Date.now()}`, 'hash', 'user');
        const uidB = createUser(`s_bob_${Date.now()}`, 'hash', 'user');
        await updateSettings({ rpcUrl: 'https://a.example', slippage: '0.5' }, null, uidA);
        await updateSettings({ rpcUrl: 'https://b.example', slippage: '0.9' }, null, uidB);
        expect((await getSettings(uidA)).rpcUrl).toBe('https://a.example');
        expect((await getSettings(uidB)).rpcUrl).toBe('https://b.example');
    });

    it('excludes the local user from admin listings', async () => {
        const users = getAllUsers();
        expect(users.some(u => u.username === 'local')).toBe(false);
        expect(Array.isArray(users)).toBe(true);
    });

    it('deletes users (admin) including their sessions', async () => {
        const uid = createUser(`doomed_${Date.now()}`, 'hash', 'user');
        const { token } = createSession(uid);
        deleteUserById(uid);
        expect(getUserById(uid)).toBeUndefined();
        expect(getSessionUser(token)).toBeNull();
    });

    // ---- Data-detailed: prune boundary (5 most recent per user + new sim) ----
    // resetPortfolio prunes to the 5 most recent THEN inserts a new one →
    // steady state is 6 sims, with the oldest dropped each time.
    it('prune drops the oldest once the user exceeds 5+1', async () => {
        const uid = createUser(`pruner_${Date.now()}`, 'hash', 'user');
        for (let i = 1; i <= 7; i++) {
            await resetPortfolio(1000 * i, `Prune Run ${i}`, null, uid);
        }
        const sims = await getAllSimulations(uid);
        expect(sims.length).toBe(6); // 5 kept + 1 new
        expect(sims.some(s => s.name === 'Prune Run 1')).toBe(false); // oldest dropped
        expect(sims.some(s => s.name === 'Prune Run 7')).toBe(true);  // newest kept
        // the surviving batch is contiguous (runs 2..7)
        expect(sims.map(s => s.name)).toEqual([
            'Prune Run 7', 'Prune Run 6', 'Prune Run 5', 'Prune Run 4', 'Prune Run 3', 'Prune Run 2',
        ]);
    });

    it('prune under the limit keeps everything', async () => {
        const uid = createUser(`pruner2_${Date.now()}`, 'hash', 'user');
        for (let i = 1; i <= 4; i++) {
            await resetPortfolio(1000, `Small ${i}`, null, uid);
        }
        const sims = await getAllSimulations(uid);
        expect(sims.length).toBe(4);
    });
});
