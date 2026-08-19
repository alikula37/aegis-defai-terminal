import { describe, it, expect } from 'vitest';
import { Backtester } from '../backtest/Backtester.js';

describe('Backtester', () => {
    // Deterministic 90-day synthetic dataset: ~5% yield vs 4% borrow at 4x,
    // with daily variation so Sharpe/MaxDD are meaningful
    const makeDataset = (days = 90, susdeApy = 5, borrowApy = 4) => {
        const out = [];
        const start = new Date('2026-01-01T00:00:00Z');
        for (let i = 0; i < days; i++) {
            const d = new Date(start);
            d.setDate(d.getDate() + i);
            const apy = susdeApy + 0.5 * Math.sin(i);
            out.push({ date: d.toISOString().slice(0, 10), susdeApy: apy, borrowApy, fundingApy: 0 });
        }
        return out;
    };

    it('computes positive return when yield exceeds borrow cost', async () => {
        const bt = await Backtester.runBacktest({ leverage: 4, gasImpactApy: 0.5, dataset: makeDataset() });
        expect(bt.error).toBeUndefined();
        expect(bt.totalReturn).toBeGreaterThan(0);
        expect(bt.days).toBe(90);
        // net APY at 4x ~ 5*4 - 4*3 - 0.5 = 7.5% (varies ± with daily sinusoid)
        expect(bt.last.loopNetApy).toBeGreaterThan(5);
        expect(bt.sharpe).toBeGreaterThan(0);
        expect(bt.maxDrawdown).toBeGreaterThanOrEqual(0);
    });

    it('reports negative return when borrow cost exceeds yield (honest data)', async () => {
        const bt = await Backtester.runBacktest({ leverage: 4, gasImpactApy: 0.5, dataset: makeDataset(90, 4, 6) });
        expect(bt.totalReturn).toBeLessThan(0);
        expect(bt.sharpe).toBeLessThan(0);
    });

    it('returns error when insufficient data', async () => {
        const bt = await Backtester.runBacktest({ dataset: makeDataset(3) });
        expect(bt.error).toContain('Not enough');
    });

    it('Monte Carlo is deterministic for a fixed seed', async () => {
        const a = await Backtester.runMonteCarlo({ simulations: 200, days: 30, seed: 7 });
        const b = await Backtester.runMonteCarlo({ simulations: 200, days: 30, seed: 7 });
        expect(a).toEqual(b);
        expect(a.liquidationProbability).toBeGreaterThanOrEqual(0);
        expect(a.liquidationProbability).toBeLessThanOrEqual(1);
    });

    it('Monte Carlo returns a return distribution histogram', async () => {
        const a = await Backtester.runMonteCarlo({ simulations: 300, days: 30, seed: 7 });
        expect(Array.isArray(a.distribution)).toBe(true);
        expect(a.distribution.length).toBeGreaterThan(0);
        const total = a.distribution.reduce((sum, b) => sum + b.count, 0);
        expect(total).toBe(a.simulations);
        expect(a.distribution.every(b => b.count >= 0 && b.lower <= b.upper)).toBe(true);
    });

    it('sweep returns one row per leverage level', async () => {
        const sweep = await Backtester.sweep({ leverages: [2, 3, 4], dataset: makeDataset() });
        expect(sweep.length).toBe(3);
        expect(sweep.map(r => r.leverage)).toEqual([2, 3, 4]);
    });

    // ---- Data-detailed: market regime × leverage matrix (exact math) ----
    // With a CONSTANT dataset (no sinusoid) every expectation is exact:
    // loopNetApy = susde*lev - borrow*(lev-1) - gasImpact.
    const REGIMES = [
        { name: 'bull', susde: 12, borrow: 4 },
        { name: 'bear', susde: 3, borrow: 6 },
        { name: 'flat', susde: 5, borrow: 4.8 },
        { name: 'volatile', susde: 8, borrow: 4 },
    ];
    const flatDataset = (days, susde, borrow) => {
        const out = [];
        const start = new Date('2026-01-01T00:00:00Z');
        for (let i = 0; i < days; i++) {
            const d = new Date(start);
            d.setDate(d.getDate() + i);
            out.push({ date: d.toISOString().slice(0, 10), susdeApy: susde, borrowApy: borrow, fundingApy: 0 });
        }
        return out;
    };

    it.each(REGIMES.flatMap(regime =>
        [2, 3, 5, 10].map(leverage => ({ regime: regime.name, leverage, susde: regime.susde, borrow: regime.borrow }))
    ))('regime=$regime leverage=$leverage → exact loop APY, finite metrics', async ({ leverage, susde, borrow }) => {
        const gasImpact = 0.5;
        const bt = await Backtester.runBacktest({ leverage, gasImpactApy: gasImpact, dataset: flatDataset(90, susde, borrow) });
        expect(bt.error).toBeUndefined();
        const expectedApy = susde * leverage - borrow * (leverage - 1) - gasImpact;
        expect(bt.last.loopNetApy).toBeCloseTo(expectedApy, 9);
        // totalReturn = compounded 90-day return ((1 + apy/36500)^90 - 1) * 100
        const expectedTotal = (Math.pow(1 + expectedApy / 36500, 90) - 1) * 100;
        expect(bt.totalReturn).toBeCloseTo(expectedTotal, 6);
        for (const key of ['totalReturn', 'cagr', 'sharpe', 'maxDrawdown', 'liquidationPriceAtLeverage']) {
            expect(Number.isFinite(bt[key])).toBe(true);
            if (key.includes('Drawdown')) expect(bt[key]).toBeGreaterThanOrEqual(0);
            if (key.includes('liquidation')) expect(bt[key]).toBeGreaterThan(0);
        }
        // zero-variance dataset → Sharpe exactly 0 (no NaN)
        expect(Number.isFinite(bt.sharpe)).toBe(true);
    });

    it('exposes the full risk report (Sortino, VaR, CVaR, vol, win rate)', async () => {
        const bt = await Backtester.runBacktest({ leverage: 4, gasImpactApy: 0.5, dataset: makeDataset() });
        expect(bt.error).toBeUndefined();
        for (const key of ['sortino', 'annualizedVolatilityPct', 'vaR95Pct', 'cVaR95Pct', 'winRate']) {
            expect(Number.isFinite(bt[key])).toBe(true);
        }
        expect(bt.riskMetrics).toBeDefined();
        expect(bt.riskMetrics.sharpeRatio).toBeCloseTo(bt.sharpe, 9);
        // Bootstrap CI and out-of-sample evaluation present.
        expect(bt.bootstrap).toBeDefined();
        expect(Number.isFinite(bt.bootstrap.lo95)).toBe(true);
        expect(bt.bootstrap.hi95).toBeGreaterThanOrEqual(bt.bootstrap.lo95);
        expect(bt.outOfSample).toBeDefined();
        expect(bt.outOfSample.trainDays + bt.outOfSample.testDays).toBe(90);
        expect(Number.isFinite(bt.outOfSample.testCagr)).toBe(true);
    });

    it('is deterministic for a fixed seed (bootstrap CI)', async () => {
        const a = await Backtester.runBacktest({ leverage: 4, dataset: makeDataset(90, 5, 4), seed: 7 });
        const b = await Backtester.runBacktest({ leverage: 4, dataset: makeDataset(90, 5, 4), seed: 7 });
        expect(a.bootstrap).toEqual(b.bootstrap);
        expect(a.outOfSample).toEqual(b.outOfSample);
    });

    it('risk-free rate reduces the Sharpe ratio', async () => {
        const base = await Backtester.runBacktest({ leverage: 4, dataset: makeDataset(90, 5, 4), riskFreeRatePct: 0 });
        const withRf = await Backtester.runBacktest({ leverage: 4, dataset: makeDataset(90, 5, 4), riskFreeRatePct: 4 });
        expect(withRf.sharpe).toBeLessThan(base.sharpe);
    });

    it.each([
        { days: 0, ok: false },
        { days: 3, ok: false },
        { days: 6, ok: false },
        { days: 7, ok: true },
        { days: 30, ok: true },
        { days: 365, ok: true },
    ])('dataset length %s days → usable=%s (min 7)', async ({ days, ok }) => {
        const bt = await Backtester.runBacktest({ dataset: flatDataset(days, 6, 4) });
        if (ok) {
            expect(bt.error).toBeUndefined();
            expect(bt.days).toBe(days);
        } else {
            expect(bt.error).toContain('Not enough');
        }
    });
});

describe('HistoricalDataService (DB)', () => {
    it('recordSnapshot and readback round-trips', async () => {
        const db = await import('../db/database.js');
        const H = await import('../services/HistoricalDataService.js');
        db.clearMarketHistory('cycle_snapshot');
        H.HistoricalDataService.recordSnapshot({ susdeApy: 4.5, netApy: 7, portfolio: { tvl: 1000 } });
        const rows = await db.getMarketHistory('cycle_snapshot', 'all', 10);
        expect(rows.length).toBeGreaterThan(0);
        const parsed = JSON.parse(rows[0].payload_json);
        expect(parsed.susdeApy).toBe(4.5);
    });
});
