// ---- RiskMetrics: pure, dependency-free quant analytics ----
// Operates on a series of daily *percentage* returns and/or an equity curve.
// No RNG, no I/O — fully unit-testable and reproducible.

function mean(xs) {
    if (!xs.length) return 0;
    return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sampleStd(xs) {
    if (xs.length < 2) return 0;
    const m = mean(xs);
    const variance = xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1);
    return Math.sqrt(variance);
}

function quantile(sortedAsc, q) {
    if (!sortedAsc.length) return 0;
    const pos = Math.min(sortedAsc.length - 1, Math.max(0, (sortedAsc.length - 1) * q));
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return sortedAsc[lo];
    return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

/** Annualized volatility from daily % returns. */
export function annualizedVolatility(dailyReturnsPct, periodsPerYear = 365) {
    return sampleStd(dailyReturnsPct) * Math.sqrt(periodsPerYear);
}

/** Annualized Sharpe (excess over risk-free, default 0). Guards std=0/NaN. */
export function sharpeRatio(dailyReturnsPct, { riskFreeRatePct = 0, periodsPerYear = 365 } = {}) {
    const sd = sampleStd(dailyReturnsPct);
    if (!Number.isFinite(sd) || sd === 0) return 0;
    const excessDaily = mean(dailyReturnsPct) - riskFreeRatePct / periodsPerYear;
    return (excessDaily * periodsPerYear) / (sd * Math.sqrt(periodsPerYear));
}

function downsideDeviation(dailyReturnsPct, riskFreeRatePct, periodsPerYear) {
    const target = riskFreeRatePct / periodsPerYear;
    const sq = dailyReturnsPct.reduce((acc, r) => {
        const dev = Math.min(r - target, 0);
        return acc + dev * dev;
    }, 0);
    return Math.sqrt(sq / Math.max(1, dailyReturnsPct.length - 1));
}

/** Annualized Sortino — penalizes only downside volatility. */
export function sortinoRatio(dailyReturnsPct, { riskFreeRatePct = 0, periodsPerYear = 365 } = {}) {
    if (dailyReturnsPct.length < 2) return 0;
    const dd = downsideDeviation(dailyReturnsPct, riskFreeRatePct, periodsPerYear);
    if (dd === 0) return 0;
    const excessAnnual = (mean(dailyReturnsPct) - riskFreeRatePct / periodsPerYear) * periodsPerYear;
    return excessAnnual / (dd * Math.sqrt(periodsPerYear));
}

/** Max drawdown (% , positive) from an equity curve (starting at 1 or any value). */
export function maxDrawdown(equityCurve) {
    if (!equityCurve.length) return 0;
    let peak = equityCurve[0];
    let maxDd = 0;
    for (const v of equityCurve) {
        if (v > peak) peak = v;
        const dd = (peak - v) / peak;
        if (dd > maxDd) maxDd = dd;
    }
    return maxDd * 100;
}

/**
 * Historical VaR: worst daily return at the (1-confidence) tail, reported as a
 * positive loss magnitude. Returns 0 if the tail quantile is a gain.
 */
export function historicalVaR(dailyReturnsPct, confidence = 0.95) {
    if (!dailyReturnsPct.length) return 0;
    const sorted = [...dailyReturnsPct].sort((a, b) => a - b);
    const tail = quantile(sorted, 1 - confidence);
    return Math.max(0, -tail);
}

/** Parametric VaR: normal approximation mu - z*sigma at the (1-confidence) tail. */
export function parametricVaR(dailyReturnsPct, confidence = 0.95) {
    if (dailyReturnsPct.length < 2) return 0;
    const z = NORM_INV[confidence] ?? 1.645;
    const sd = sampleStd(dailyReturnsPct);
    return Math.max(0, -(mean(dailyReturnsPct) + z * sd));
}

/** Conditional VaR / expected shortfall: average of the worst (1-confidence) tail. */
export function conditionalVaR(dailyReturnsPct, confidence = 0.95) {
    if (!dailyReturnsPct.length) return 0;
    const n = Math.max(1, Math.floor((1 - confidence) * dailyReturnsPct.length));
    const sorted = [...dailyReturnsPct].sort((a, b) => a - b);
    const tail = sorted.slice(0, n);
    return Math.max(0, -mean(tail));
}

/** Fraction of periods with positive return. */
export function winRate(dailyReturnsPct) {
    if (!dailyReturnsPct.length) return 0;
    return dailyReturnsPct.filter(r => r > 0).length / dailyReturnsPct.length;
}

/**
 * Rolling (windowed) annualized volatility. Returns one point per window:
 * [{ i, volPct }] where i is the last index of the window (so the series can
 * be aligned with the equity/time axis).
 */
export function rollingVolatility(dailyReturnsPct, window = 30, periodsPerYear = 365) {
    if (!dailyReturnsPct.length) return [];
    const w = Math.max(2, Math.min(Math.floor(window), dailyReturnsPct.length));
    const out = [];
    for (let end = w; end <= dailyReturnsPct.length; end++) {
        const slice = dailyReturnsPct.slice(end - w, end);
        out.push({ i: end - 1, volPct: annualizedVolatility(slice, periodsPerYear) });
    }
    return out;
}

/**
 * Histogram of daily returns into N buckets — the input to a return
 * distribution chart. Buckets are rounded to 2 decimals for stable labels.
 */
export function returnHistogram(dailyReturnsPct, buckets = 10) {
    if (!dailyReturnsPct.length) return [];
    const n = Math.max(2, Math.min(Math.floor(buckets), 30));
    const min = Math.min(...dailyReturnsPct);
    const max = Math.max(...dailyReturnsPct);
    if (min === max) return [{ bucket: round2(min), count: dailyReturnsPct.length }];
    const width = (max - min) / n;
    const counts = new Array(n).fill(0);
    for (const r of dailyReturnsPct) {
        let idx = Math.floor((r - min) / width);
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

/** Calmar ratio: annualized mean return / max drawdown (guard dd=0 → 0). */
export function calmarRatio(dailyReturnsPct, equityCurve = null, periodsPerYear = 365) {
    const dd = equityCurve ? maxDrawdown(equityCurve) : 0;
    if (dd <= 0) return 0;
    return (mean(dailyReturnsPct) * periodsPerYear) / dd;
}

/**
 * Tail ratio: mean of the best 5% / |mean of the worst 5%| returns. A value
 * > 1 means upside tails dominate downside tails.
 */
export function tailRatio(dailyReturnsPct, tailPct = 0.05) {
    if (dailyReturnsPct.length < 20) return 0;
    const n = Math.max(1, Math.floor(dailyReturnsPct.length * tailPct));
    const sorted = [...dailyReturnsPct].sort((a, b) => a - b);
    const upside = sorted.slice(-n);
    const downside = sorted.slice(0, n);
    const dMean = Math.abs(mean(downside));
    if (dMean === 0) return 0;
    return mean(upside) / dMean;
}

function round2(n) {
    return Math.round(n * 100) / 100;
}

/**
 * Beta vs a benchmark return series (cov/var). Returns null when there is no
 * benchmark or the benchmark is constant.
 */
export function beta(dailyReturnsPct, benchmarkReturnsPct) {
    if (!benchmarkReturnsPct || benchmarkReturnsPct.length < 2 || dailyReturnsPct.length < 2) return null;
    const n = Math.min(dailyReturnsPct.length, benchmarkReturnsPct.length);
    const a = dailyReturnsPct.slice(0, n);
    const b = benchmarkReturnsPct.slice(0, n);
    const ma = mean(a);
    const mb = mean(b);
    const varb = b.reduce((acc, x) => acc + (x - mb) ** 2, 0) / (n - 1);
    if (varb === 0) return null;
    const cov = a.reduce((acc, x, i) => acc + (x - ma) * (b[i] - mb), 0) / (n - 1);
    return cov / varb;
}

/**
 * One-stop shop. Returns a complete risk report for a return series (+ optional
 * equity curve for drawdown, + optional benchmark for beta).
 */
export function computeRiskMetrics({
    dailyReturnsPct = [],
    equityCurve = null,
    confidence = 0.95,
    riskFreeRatePct = 0,
    periodsPerYear = 365,
    benchmarkReturnsPct = null,
} = {}) {
    return {
        periods: dailyReturnsPct.length,
        meanDailyReturnPct: mean(dailyReturnsPct),
        meanAnnualReturnPct: mean(dailyReturnsPct) * periodsPerYear,
        annualizedVolatilityPct: annualizedVolatility(dailyReturnsPct, periodsPerYear),
        sharpeRatio: sharpeRatio(dailyReturnsPct, { riskFreeRatePct, periodsPerYear }),
        sortinoRatio: sortinoRatio(dailyReturnsPct, { riskFreeRatePct, periodsPerYear }),
        maxDrawdownPct: equityCurve ? maxDrawdown(equityCurve) : 0,
        historicalVaRPct: historicalVaR(dailyReturnsPct, confidence),
        parametricVaRPct: parametricVaR(dailyReturnsPct, confidence),
        conditionalVaRPct: conditionalVaR(dailyReturnsPct, confidence),
        winRate: winRate(dailyReturnsPct),
        beta: benchmarkReturnsPct ? beta(dailyReturnsPct, benchmarkReturnsPct) : null,
        calmarRatio: calmarRatio(dailyReturnsPct, equityCurve, periodsPerYear),
        tailRatio: tailRatio(dailyReturnsPct),
        confidence,
    };
}

// Standard normal quantiles (z) for the confidence levels we support.
const NORM_INV = { 0.9: 1.282, 0.95: 1.645, 0.99: 2.326 };