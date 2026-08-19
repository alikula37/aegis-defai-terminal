import { HistoricalDataService } from '../services/HistoricalDataService.js';
import { createSeededRandom } from '../utils/rng.js';
import {
    computeRiskMetrics,
    sharpeRatio,
} from '../core/quant/RiskMetrics.js';

const LIQUIDATION_THRESHOLD = 0.94; // sUSDe liquidation threshold on Morpho

export function loopNetApy(susdeApy, borrowApy, leverage) {
    return susdeApy * leverage - borrowApy * (leverage - 1);
}

function liquidationPrice(leverage) {
    // HF = (L * price * LT) / (L - 1); liquidation when HF < 1
    return (leverage - 1) / (leverage * LIQUIDATION_THRESHOLD);
}

function computeSharpe(dailyReturnsPct, riskFreeRatePct = 0) {
    // dailyReturnsPct here is the *daily APY* (%). Passed to RiskMetrics as
    // actual daily returns (apy/365) so the annualization math stays exact.
    return sharpeRatio(dailyReturnsPct.map(r => r / 365), { riskFreeRatePct, periodsPerYear: 365 });
}

function computeMaxDrawdown(equityCurve) {
    let peak = equityCurve[0] ?? 1;
    let maxDd = 0;
    for (const v of equityCurve) {
        if (v > peak) peak = v;
        const dd = (peak - v) / peak;
        if (dd > maxDd) maxDd = dd;
    }
    return maxDd * 100;
}

function aggregateMonthly(dates, dailyReturnsPct) {
    const map = new Map();
    dates.forEach((d, i) => {
        const month = dateOf(d).slice(0, 7);
        if (!map.has(month)) map.set(month, []);
        map.get(month).push(dailyReturnsPct[i]);
    });
    return [...map.entries()].map(([month, returns]) => {
        // Compound the daily % returns within the month
        let equity = 1;
        for (const apy of returns) {
            equity *= (1 + apy / 100 / 365);
        }
        return {
            month,
            returnPct: (equity - 1) * 100,
            netApy: returns[returns.length - 1] ?? 0,
        };
    });
}

/** Compound a daily-APY series into (final equity, equity curve). */
function compoundSeries(dailyNetApy) {
    let equity = 1;
    const curve = [];
    for (const apy of dailyNetApy) {
        equity *= (1 + apy / 100 / 365);
        curve.push(equity);
    }
    return { equity, curve };
}

/**
 * Bootstrap confidence interval for CAGR: resample the daily returns with
 * replacement and recompute the compounded growth many times (seeded → reproducible).
 */
function bootstrapCagr(dailyNetApy, iterations = 500, seed = 42) {
    if (dailyNetApy.length === 0) return { meanCagr: 0, lo95: 0, hi95: 0 };
    const rand = createSeededRandom(seed);
    const n = dailyNetApy.length;
    const cagrs = [];
    for (let i = 0; i < iterations; i++) {
        let eq = 1;
        for (let j = 0; j < n; j++) {
            const apy = dailyNetApy[Math.floor(rand() * n)];
            eq *= (1 + apy / 100 / 365);
        }
        const years = n / 365;
        cagrs.push(years > 0 ? (Math.pow(eq, 1 / years) - 1) * 100 : 0);
    }
    cagrs.sort((a, b) => a - b);
    const idx = (q) => cagrs[Math.min(cagrs.length - 1, Math.floor(q * cagrs.length))];
    return {
        meanCagr: cagrs.reduce((a, b) => a + b, 0) / cagrs.length,
        lo95: idx(0.025),
        hi95: idx(0.975),
        iterations,
    };
}

/** Out-of-sample split: train on the first 80%, evaluate on the last 20%. */
function outOfSampleSplit(dates, dailyNetApy) {
    if (dates.length < 10) return null;
    const split = Math.floor(dates.length * 0.8);
    const train = dailyNetApy.slice(0, split);
    const test = dailyNetApy.slice(split);
    const { equity: trainEq } = compoundSeries(train);
    const { equity: testEq } = compoundSeries(test);
    const cagr = (eq, n) => {
        const years = n / 365;
        return years > 0 ? (Math.pow(eq, 1 / years) - 1) * 100 : 0;
    };
    return {
        trainDays: train.length,
        testDays: test.length,
        trainCagr: cagr(trainEq, train.length),
        testCagr: cagr(testEq, test.length),
        totalReturnPct: (testEq - 1) * 100,
        startDate: dateOf(dates[split]),
        endDate: dateOf(dates[dates.length - 1]),
    };
}

/** Normalize a date reference (ISO string or {date}) to a plain date string. */
function dateOf(d) {
    if (d == null) return '';
    if (typeof d === 'string') return d.slice(0, 10);
    if (typeof d.date === 'string') return d.date.slice(0, 10);
    return '';
}

export class Backtester {
    /**
     * Shared report builder: given a daily net-APY series (percent) and its
     * aligned dates, compute the full metric report (CAGR, Sharpe, drawdown,
     * VaR, bootstrap CI, out-of-sample split, monthly + equity curve).
     * @param {object} opts { dailyNetApy, dates, leverage, gasImpactApy, riskFreeRatePct, seed }
     */
    static _backtestSeries({ dailyNetApy, dates = [], riskFreeRatePct = 0, seed = 42 } = {}) {
        const { equity, curve } = compoundSeries(dailyNetApy);
        const totalReturn = (equity - 1) * 100;
        const years = dailyNetApy.length / 365;
        const cagr = years > 0 ? (Math.pow(equity, 1 / years) - 1) * 100 : 0;
        const sharpe = computeSharpe(dailyNetApy, riskFreeRatePct);
        const maxDrawdown = computeMaxDrawdown(curve);

        const riskMetrics = computeRiskMetrics({
            dailyReturnsPct: dailyNetApy.map(r => r / 365),
            equityCurve: curve,
            riskFreeRatePct,
            periodsPerYear: 365,
            confidence: 0.95,
        });

        return {
            totalReturn,
            cagr,
            sharpe,
            maxDrawdown,
            sortino: riskMetrics.sortinoRatio,
            annualizedVolatilityPct: riskMetrics.annualizedVolatilityPct,
            vaR95Pct: riskMetrics.historicalVaRPct,
            cVaR95Pct: riskMetrics.conditionalVaRPct,
            winRate: riskMetrics.winRate,
            riskMetrics,
            bootstrap: bootstrapCagr(dailyNetApy, 500, seed),
            outOfSample: outOfSampleSplit(dates, dailyNetApy),
            monthly: aggregateMonthly(dates, dailyNetApy),
            equityCurve: curve.map((v, i) => ({ date: dateOf(dates[i]), equity: v })),
        };
    }

    /**
     * Backtest an arbitrary daily net-APY series (used by the strategy
     * comparison: direct sUSDe, Pendle, Morpho supply, the leverage loop).
     * @param {object} opts { dailyNetApy, dates, leverage, gasImpactApy, seed }
     */
    static runStrategySeries({ dailyNetApy = [], dates = [], leverage = 1, gasImpactApy = 0.5, seed = 42 } = {}) {
        const filled = dailyNetApy
            .map((net, i) => ({ date: dateOf(dates[i]), net }))
            .filter(d => d.net != null && Number.isFinite(d.net));
        if (filled.length < 7) {
            return { error: 'Not enough historical data to backtest.', days: filled.length };
        }
        const series = this._backtestSeries({
            dailyNetApy: filled.map(d => d.net),
            dates: filled.map(d => d.date),
            leverage,
            gasImpactApy,
            seed,
        });
        return {
            days: filled.length,
            currentNetApy: filled[filled.length - 1].net,
            startDate: filled[0].date,
            endDate: filled[filled.length - 1].date,
            ...series,
        };
    }

    /**
     * Backtest the delta-neutral loop strategy on real historical APY data.
     * @param {object} opts { rangeDays, leverage, gasImpactApy, riskFreeRatePct, dataset, seed }
     *   dataset: optional array of { date, susdeApy, borrowApy, fundingApy } (used by tests / callers)
     */
    static async runBacktest({ rangeDays = 90, leverage = 4, gasImpactApy = 0.5, riskFreeRatePct = 0, dataset = null, seed = 42 } = {}) {
        const data = dataset || await HistoricalDataService.buildBacktestDataset(rangeDays);
        const filled = data.filter(d => d.susdeApy != null && d.borrowApy != null);
        if (filled.length < 7) {
            return { error: 'Not enough historical data to backtest.', days: filled.length };
        }

        const dailyNetApy = filled.map(d => loopNetApy(d.susdeApy, d.borrowApy, leverage) - gasImpactApy);
        const series = this._backtestSeries({
            dailyNetApy,
            dates: filled.map(d => d.date),
            leverage,
            gasImpactApy,
            riskFreeRatePct,
            seed,
        });

        return {
            strategy: 'Pendle PT-sUSDe Delta-Neutral Loop',
            rangeDays,
            leverage,
            gasImpactApy,
            riskFreeRatePct,
            days: filled.length,
            totalReturn: series.totalReturn,
            cagr: series.cagr,
            sharpe: series.sharpe,
            maxDrawdown: series.maxDrawdown,
            sortino: series.sortino,
            annualizedVolatilityPct: series.annualizedVolatilityPct,
            vaR95Pct: series.vaR95Pct,
            cVaR95Pct: series.cVaR95Pct,
            winRate: series.winRate,
            riskMetrics: series.riskMetrics,
            bootstrap: series.bootstrap,
            outOfSample: series.outOfSample,
            liquidationPriceAtLeverage: liquidationPrice(leverage),
            startDate: filled[0].date,
            endDate: filled[filled.length - 1].date,
            last: {
                date: filled[filled.length - 1].date,
                susdeApy: filled[filled.length - 1].susdeApy,
                borrowApy: filled[filled.length - 1].borrowApy,
                loopNetApy: dailyNetApy[dailyNetApy.length - 1],
            },
            monthly: series.monthly,
            equityCurve: series.equityCurve,
        };
    }

    /**
     * Monte Carlo simulation of the loop strategy.
     * Models daily net-APY noise and sUSDe price depeg risk to estimate
     * liquidation probability and return distribution.
     * @param {object} opts { meanApy, sigmaApy, priceVol, days, leverage, simulations, seed }
     */
    static async runMonteCarlo({
        meanApy = 5, sigmaApy = 8, priceVol = 0.003,
        days = 90, leverage = 4, simulations = 1000, seed = 42,
    } = {}) {
        const rand = createSeededRandom(seed);
        const liqPrice = liquidationPrice(leverage);
        let liquidations = 0;
        const finalEquities = [];

        for (let s = 0; s < simulations; s++) {
            let equity = 1;
            let price = 1;
            let liquidated = false;

            for (let d = 0; d < days; d++) {
                // Daily net APY ~ N(meanApy, sigmaApy), clamped to a sane range
                let apy = gaussian(rand) * sigmaApy + meanApy;
                apy = Math.max(-50, Math.min(50, apy));
                equity *= (1 + apy / 100 / 365);

                // sUSDe price random walk (soft-peg)
                price *= (1 + gaussian(rand) * priceVol);
                if (price < liqPrice) {
                    liquidated = true;
                    break;
                }
            }

            if (liquidated) {
                liquidations++;
                finalEquities.push(0);
            } else {
                finalEquities.push(equity);
            }
        }

        const sorted = [...finalEquities].sort((a, b) => a - b);
        const pct = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

        // Return distribution histogram (of total returns, %) for the UI.
        const returnsPct = finalEquities.map(e => (e - 1) * 100);
        const distribution = histogram(returnsPct, 12);

        return {
            strategy: 'Pendle PT-sUSDe Delta-Neutral Loop (Monte Carlo)',
            simulations,
            days,
            leverage,
            liquidationPriceAtLeverage: liqPrice,
            liquidationProbability: liquidations / simulations,
            medianReturnPct: (pct(0.5) - 1) * 100,
            p5ReturnPct: (pct(0.05) - 1) * 100,
            p95ReturnPct: (pct(0.95) - 1) * 100,
            meanReturnPct: (finalEquities.reduce((a, b) => a + b, 0) / simulations - 1) * 100,
            distribution,
        };
    }

    /**
     * Parameter sweep across leverage levels.
     */
    static async sweep({ rangeDays = 90, leverages = [2, 3, 4, 5, 6], gasImpactApy = 0.5, dataset = null } = {}) {
        const results = [];
        for (const lev of leverages) {
            const bt = await this.runBacktest({ rangeDays, leverage: lev, gasImpactApy, dataset });
            results.push({
                leverage: lev,
                cagr: bt.error ? null : bt.cagr,
                sharpe: bt.error ? null : bt.sharpe,
                maxDrawdown: bt.error ? null : bt.maxDrawdown,
                days: bt.days ?? 0,
            });
        }
        return results;
    }
}

// Box-Muller gaussian sampling using a supplied PRNG
function gaussian(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** Fixed-width histogram of a numeric array → [{ bucket, lower, upper, count }]. */
function histogram(values, buckets = 12) {
    if (!values.length) return [];
    const n = Math.max(2, Math.min(Math.floor(buckets), 40));
    const min = Math.min(...values);
    const max = Math.max(...values);
    if (min === max) return [{ bucket: round2(min), lower: min, upper: max, count: values.length }];
    const width = (max - min) / n;
    const counts = new Array(n).fill(0);
    for (const v of values) {
        let idx = Math.floor((v - min) / width);
        if (idx >= n) idx = n - 1;
        counts[idx] += 1;
    }
    return counts.map((count, idx) => ({
        bucket: round2(min + width * (idx + 0.5)),
        lower: round2(min + width * idx),
        upper: round2(min + width * (idx + 1)),
        count,
    }));
}

function round2(n) {
    return Math.round(n * 100) / 100;
}
