import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import db, { insertLog, getLogs, insertPortfolioStats, getLatestPortfolio, resetPortfolio, updateSettings, getSettings, encrypt, decrypt } from '../db/database.js';
import crypto from 'crypto';

describe('Database Operations', () => {
    beforeEach(async () => {
        // Reset DB before each test
        await resetPortfolio(10000);
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
        await resetPortfolio(5000);
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
        });
        const s = await getSettings();
        expect(s.dataMode).toBe('SIM');
        expect(s.dataScenario).toBe('bull');
        expect(s.automationRules).toHaveLength(2);
        expect(s.automationRules[0].action).toBe('Rebalance');
        expect(s.automationRules[1].enabled).toBe(false);
    });

    it('should default automation rules to empty array', async () => {
        await updateSettings({ rpcUrl: '', slippage: '0.5' });
        const s = await getSettings();
        expect(Array.isArray(s.automationRules)).toBe(true);
        expect(s.automationRules).toHaveLength(0);
    });
});
