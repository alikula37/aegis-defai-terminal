import { describe, it, expect } from 'vitest';
import aegisConfig from '../aegis.config.js';

// Data-detailed: every operational constant the app depends on must stay
// within sane ranges. This guards against a bad config edit silently changing
// security or money behavior (lockout windows, rate limits, balance caps).
describe('aegis.config.js integrity', () => {
    it('server section has valid rate-limit windows and bounds', () => {
        const s = aegisConfig.server;
        expect(s.port).toBeGreaterThan(0);
        expect(s.port).toBeLessThan(65536);
        for (const key of ['apiWindowMs', 'writeWindowMs', 'loginWindowMs']) {
            expect(Number.isFinite(s.rateLimit[key])).toBe(true);
            expect(s.rateLimit[key]).toBeGreaterThanOrEqual(60 * 1000);
        }
        for (const key of ['apiMax', 'writeMax', 'loginMax']) {
            expect(Number.isInteger(s.rateLimit[key])).toBe(true);
            expect(s.rateLimit[key]).toBeGreaterThan(0);
            expect(s.rateLimit[key]).toBeLessThanOrEqual(100000);
        }
        expect(s.wsHeartbeatIntervalMs).toBeGreaterThanOrEqual(5000);
        expect(s.maxInitialBalance).toBeGreaterThan(0);
        expect(s.defaultInitialBalance).toBeGreaterThan(0);
        expect(s.defaultInitialBalance).toBeLessThan(s.maxInitialBalance);
        expect(s.csvExportHistoryLimit).toBeGreaterThan(s.csvExportLogLimit);
    });

    it('auth section enforces sane credential policy', () => {
        const a = aegisConfig.auth;
        expect(a.sessionTtlDays).toBeGreaterThanOrEqual(1);
        expect(a.loginLockoutMaxAttempts).toBeGreaterThanOrEqual(3);
        expect(a.loginLockoutMs).toBeGreaterThanOrEqual(60 * 1000);
        // username: min < max, both within 2..64
        expect(a.usernameMin).toBeGreaterThanOrEqual(2);
        expect(a.usernameMax).toBeLessThanOrEqual(64);
        expect(a.usernameMin).toBeLessThan(a.usernameMax);
        // password: min < max, min >= 8 (OWASP), max <= 256
        expect(a.passwordMin).toBeGreaterThanOrEqual(8);
        expect(a.passwordMax).toBeLessThanOrEqual(256);
        expect(a.passwordMin).toBeLessThan(a.passwordMax);
    });

    it('execution and agent sections stay within money-safety bounds', () => {
        expect(aegisConfig.execution.slippageBps).toBeGreaterThanOrEqual(0);
        expect(aegisConfig.execution.slippageBps).toBeLessThanOrEqual(1000);
        expect(aegisConfig.execution.maxGasLimitUsd).toBeGreaterThan(0);
        expect(aegisConfig.agent.maxLeverage).toBeGreaterThan(0);
        expect(aegisConfig.agent.maxLeverage).toBeLessThanOrEqual(50);
        expect(aegisConfig.llm.budget.weeklyMaxCalls).toBeGreaterThanOrEqual(0);
        expect(aegisConfig.llm.tools.maxRounds).toBeGreaterThanOrEqual(1);
    });

    it('every numeric value is finite (no NaN/Infinity sneaking into config)', () => {
        const walk = (obj, path = '') => {
            for (const [k, v] of Object.entries(obj)) {
                if (v !== null && typeof v === 'object') walk(v, `${path}.${k}`);
                else if (typeof v === 'number') {
                    expect(Number.isFinite(v), `${path}.${k} must be finite`).toBe(true);
                }
            }
        };
        walk(aegisConfig);
    });
});
