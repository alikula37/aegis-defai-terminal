import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
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

    it('sweep returns one row per leverage level', async () => {
        const sweep = await Backtester.sweep({ leverages: [2, 3, 4], dataset: makeDataset() });
        expect(sweep.length).toBe(3);
        expect(sweep.map(r => r.leverage)).toEqual([2, 3, 4]);
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
