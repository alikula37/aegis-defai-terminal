import { HistoricalDataService } from '../services/HistoricalDataService.js';
import { createSeededRandom } from '../utils/rng.js';

const LIQUIDATION_THRESHOLD = 0.94; // sUSDe liquidation threshold on Morpho

function loopNetApy(susdeApy, borrowApy, leverage) {
    return susdeApy * leverage - borrowApy * (leverage - 1);
}

function liquidationPrice(leverage) {
    // HF = (L * price * LT) / (L - 1); liquidation when HF < 1
    return (leverage - 1) / (leverage * LIQUIDATION_THRESHOLD);
}

function computeSharpe(dailyReturnsPct) {
    if (dailyReturnsPct.length < 2) return 0;
    const mean = dailyReturnsPct.reduce((a, b) => a + b, 0) / dailyReturnsPct.length;
    const variance = dailyReturnsPct.reduce((a, b) => a + (b - mean) ** 2, 0) / (dailyReturnsPct.length - 1);
    const std = Math.sqrt(variance);
    if (std === 0) return 0;
    // annualized Sharpe from daily returns, risk-free ~0
    return (mean * 365) / (std * Math.sqrt(365));
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

function aggregateMonthly(days, dailyReturnsPct) {
    const map = new Map();
    days.forEach((d, i) => {
        const month = d.date.slice(0, 7);
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

export class Backtester {
    /**
     * Backtest the delta-neutral loop strategy on real historical APY data.
     * @param {object} opts { rangeDays, leverage, gasImpactApy, dataset }
     *   dataset: optional array of { date, susdeApy, borrowApy, fundingApy } (used by tests / callers)
     */
    static async runBacktest({ rangeDays = 90, leverage = 4, gasImpactApy = 0.5, dataset = null } = {}) {
        const data = dataset || await HistoricalDataService.buildBacktestDataset(rangeDays);
        const filled = data.filter(d => d.susdeApy != null && d.borrowApy != null);
        if (filled.length < 7) {
            return { error: 'Not enough historical data to backtest.', days: filled.length };
        }

        const dailyNetApy = filled.map(d => loopNetApy(d.susdeApy, d.borrowApy, leverage) - gasImpactApy);
        let equity = 1;
        const equityCurve = [];
        for (const apy of dailyNetApy) {
            equity *= (1 + apy / 100 / 365);
            equityCurve.push(equity);
        }

        const totalReturn = (equity - 1) * 100;
        const years = filled.length / 365;
        const cagr = years > 0 ? (Math.pow(equity, 1 / years) - 1) * 100 : 0;
        const sharpe = computeSharpe(dailyNetApy);
        const maxDrawdown = computeMaxDrawdown(equityCurve);

        return {
            strategy: 'Pendle PT-sUSDe Delta-Neutral Loop',
            rangeDays,
            leverage,
            gasImpactApy,
            days: filled.length,
            totalReturn,
            cagr,
            sharpe,
            maxDrawdown,
            liquidationPriceAtLeverage: liquidationPrice(leverage),
            startDate: filled[0].date,
            endDate: filled[filled.length - 1].date,
            last: {
                date: filled[filled.length - 1].date,
                susdeApy: filled[filled.length - 1].susdeApy,
                borrowApy: filled[filled.length - 1].borrowApy,
                loopNetApy: dailyNetApy[dailyNetApy.length - 1],
            },
            monthly: aggregateMonthly(filled, dailyNetApy),
            equityCurve: equityCurve.map((v, i) => ({ date: filled[i].date, equity: v })),
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
