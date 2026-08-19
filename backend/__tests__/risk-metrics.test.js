import { describe, it, expect } from 'vitest';
import {
    computeRiskMetrics,
    sharpeRatio,
    sortinoRatio,
    maxDrawdown,
    historicalVaR,
    parametricVaR,
    conditionalVaR,
    winRate,
    beta,
    annualizedVolatility,
    rollingVolatility,
    returnHistogram,
    calmarRatio,
    tailRatio,
} from '../core/quant/RiskMetrics.js';

describe('RiskMetrics', () => {
    it('mean/std/annualized vol from daily returns', () => {
        const vol = annualizedVolatility([1, 2, 3], 365);
        // sample std of [1,2,3] = 1  → annualized = 1 * sqrt(365)
        expect(vol).toBeCloseTo(Math.sqrt(365), 6);
    });

    it('sharpe uses excess return and guards zero variance', () => {
        expect(sharpeRatio([5, 5, 5])).toBe(0);          // std=0 → no NaN
        const s = sharpeRatio([0.05, 0.06, 0.04], { riskFreeRatePct: 0, periodsPerYear: 365 });
        expect(s).toBeGreaterThan(0);
        // risk-free reduces sharpe
        const withRf = sharpeRatio([0.05, 0.06, 0.04], { riskFreeRatePct: 2, periodsPerYear: 365 });
        expect(withRf).toBeLessThan(s);
    });

    it('sortino ignores upside volatility', () => {
        // Same scale, different downside: the series with smaller downside
        // deviations earns a higher Sortino.
        const smallDownside = [2, 2, 2, -1];
        const largeDownside = [4.4, -1.3, 4.4, -1.3];
        expect(sortinoRatio(smallDownside)).toBeGreaterThan(sortinoRatio(largeDownside));
        expect(sortinoRatio([])).toBe(0);
    });

    it('max drawdown finds the peak-to-trough fall', () => {
        expect(maxDrawdown([1, 1.2, 0.9, 1.1])).toBeCloseTo(25, 6); // (1.2-0.9)/1.2
        expect(maxDrawdown([1, 1.5, 2])).toBe(0);
        expect(maxDrawdown([])).toBe(0);
    });

    it('historical VaR = loss at the (1-confidence) percentile tail', () => {
        // 100 returns from -4.9 … +5.0 plus one catastrophic -20 outlier. The
        // 95% VaR is the 5th percentile loss — around -4.4 (the tail quantile),
        // not the single worst day (that is CVaR's job).
        const returns = Array.from({ length: 100 }, (_, i) => i / 10 - 5); // -5 … 4.9
        returns[0] = -20;
        const var95 = historicalVaR(returns, 0.95);
        expect(var95).toBeGreaterThan(4);
        expect(var95).toBeLessThan(5);
        expect(historicalVaR([1, 2, 3], 0.95)).toBe(0); // no losses → 0
    });

    it('parametric VaR matches the normal approximation', () => {
        const returns = [-1, -0.5, 0, 0.5, 1, 1.5];
        const mu = returns.reduce((a, b) => a + b, 0) / returns.length;
        const sd = Math.sqrt(returns.reduce((a, b) => a + (b - mu) ** 2, 0) / (returns.length - 1));
        const expected = Math.max(0, -(mu + 1.645 * sd));
        expect(parametricVaR(returns, 0.95)).toBeCloseTo(expected, 6);
        expect(parametricVaR([5, 5, 5], 0.95)).toBe(0);
    });

    it('conditional VaR averages the worst tail', () => {
        // 95 winners of +1 and five distinct worst losses: CVaR = mean of the
        // worst 5% tail = mean(-9,-8,-7,-6,-5) = -7 → reported as 7.
        const returns = [...Array(95).fill(1), -9, -8, -7, -6, -5];
        const cvar = conditionalVaR(returns, 0.95);
        expect(cvar).toBeCloseTo(7, 6);
    });

    it('win rate is the share of positive periods', () => {
        expect(winRate([1, 2, -1, -2])).toBe(0.5);
        expect(winRate([])).toBe(0);
    });

    it('beta vs a perfectly correlated benchmark', () => {
        const a = [1, 2, 3, 4, 5];
        const b = [2, 4, 6, 8, 10]; // b = 2a → beta = 0.5
        expect(beta(a, b)).toBeCloseTo(0.5, 6);
        expect(beta(a, [1, 1, 1, 1, 1])).toBeNull(); // constant benchmark
        expect(beta(a, null)).toBeNull();
    });

    it('computeRiskMetrics returns a complete report', () => {
        const report = computeRiskMetrics({
            dailyReturnsPct: [0.1, -0.2, 0.3, 0.15, -0.1],
            equityCurve: [1, 1.1, 0.95, 1.05],
            confidence: 0.95,
        });
        for (const key of ['periods', 'meanDailyReturnPct', 'meanAnnualReturnPct', 'annualizedVolatilityPct', 'sharpeRatio', 'sortinoRatio', 'maxDrawdownPct', 'historicalVaRPct', 'parametricVaRPct', 'conditionalVaRPct', 'winRate', 'calmarRatio', 'tailRatio', 'confidence']) {
            expect(Number.isFinite(report[key])).toBe(true);
        }
        expect(report.periods).toBe(5);
        expect(report.maxDrawdownPct).toBeCloseTo((1.1 - 0.95) / 1.1 * 100, 6);
        expect(report.beta).toBeNull();
    });

    it('rollingVolatility yields one windowed annualized-vol point per window', () => {
        const series = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2];
        const roll = rollingVolatility(series, 5, 365);
        expect(roll.length).toBe(series.length - 5 + 1);
        // First window (all 1s) has zero variance → vol 0.
        expect(roll[0].volPct).toBe(0);
        expect(roll[0].i).toBe(4);
        // The window that spans the 1→2 step has non-zero vol.
        expect(roll.some(r => r.volPct > 0)).toBe(true);
        expect(rollingVolatility([], 5)).toEqual([]);
    });

    it('returnHistogram bins daily returns and sums back to the input size', () => {
        const returns = Array.from({ length: 40 }, (_, i) => (i % 4) - 1.5); // -1.5..1.5
        const hist = returnHistogram(returns, 8);
        expect(hist.length).toBe(8);
        expect(hist.reduce((a, b) => a + b.count, 0)).toBe(returns.length);
        expect(hist.every(h => h.count >= 0 && h.lower <= h.upper)).toBe(true);
        expect(returnHistogram([], 8)).toEqual([]);
        expect(returnHistogram([3, 3, 3], 8)).toEqual([{ bucket: 3, count: 3 }]);
    });

    it('calmarRatio = mean annual return / max drawdown (dd=0 guard)', () => {
        const daily = [0.05, 0.05, 0.05]; // mean 0.05/day
        const equity = [1, 0.9, 1.1]; // maxDD 10%
        expect(calmarRatio(daily, equity, 365)).toBeCloseTo((0.05 * 365) / 10, 6);
        expect(calmarRatio(daily, [1, 1, 1], 365)).toBe(0);
    });

    it('tailRatio is upside mean / |downside mean| (0 when data is too small)', () => {
        const returns = [...Array(80).fill(1), ...Array(20).fill(-0.5)];
        // tailPct 5% → top 5 (+1) vs bottom 5 (-0.5) → 1 / 0.5 = 2
        expect(tailRatio(returns, 0.05)).toBeCloseTo(2, 6);
        expect(tailRatio([1, -1], 0.05)).toBe(0); // < 20 samples
    });
});