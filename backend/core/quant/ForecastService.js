// ---- ForecastService: lightweight time-series forecasting, pure JS ----
// Holt's linear exponential smoothing (level + trend) for the point forecast,
// EWMA volatility for a growing uncertainty band. Deterministic, no deps,
// fully unit-testable. The band is an educational estimate, not a promise.

function ewmaVariance(returns, lambda = 0.94) {
    if (!returns.length) return 0;
    let v = 0;
    const meanR = returns.reduce((a, b) => a + b, 0) / returns.length;
    for (const r of returns) {
        v = lambda * v + (1 - lambda) * (r - meanR) ** 2;
    }
    return v;
}

/**
 * Holt's linear method. Returns per-observation level, trend, one-step-ahead
 * fitted values, the final level/trend and residual-based error metrics.
 */
export function holtLinear(series, { alpha = 0.4, beta = 0.2, initialLevel = null, initialTrend = 0 } = {}) {
    if (!series.length) {
        return { level: [], trend: [], fitted: [], lastLevel: null, lastTrend: 0, residuals: [], mse: 0, rmse: 0, mae: 0 };
    }

    const level = new Array(series.length);
    const trend = new Array(series.length);
    const fitted = new Array(series.length);

    level[0] = initialLevel !== null ? initialLevel : series[0];
    trend[0] = series.length > 1 ? initialTrend : 0;
    fitted[0] = level[0];

    for (let i = 1; i < series.length; i++) {
        const prevLevel = level[i - 1];
        const prevTrend = trend[i - 1];
        fitted[i] = prevLevel + prevTrend;
        level[i] = alpha * series[i] + (1 - alpha) * (prevLevel + prevTrend);
        trend[i] = beta * (level[i] - prevLevel) + (1 - beta) * prevTrend;
    }

    const residuals = series.map((v, i) => v - fitted[i]);
    const mse = meanSquare(residuals);
    return {
        level,
        trend,
        fitted,
        lastLevel: level[level.length - 1],
        lastTrend: trend[trend.length - 1],
        residuals,
        mse,
        rmse: Math.sqrt(mse),
        mae: residuals.reduce((a, b) => a + Math.abs(b), 0) / Math.max(1, residuals.length),
    };
}

function meanSquare(xs) {
    if (!xs.length) return 0;
    return xs.reduce((a, b) => a + b * b, 0) / xs.length;
}

/**
 * Forecast a time series with a confidence band.
 *
 * @param {object} opts {
 *   values:      array of numbers (e.g. daily net APY %), oldest → newest
 *   horizon:     number of future steps (default 7)
 *   alpha, beta: Holt smoothing parameters
 *   confidence:  band width in std devs (z-score, default 1.645 ≈ 90%)
 *   periodsPerYear: for annualizing the trend report
 * }
 * @returns {
 *   fitted:      array of { i, value: actual, forecast: fitted }
 *   future:      array of { step, value, upper, lower }
 *   lastLevel, lastTrend, trendPerPeriodPct, trendAnnualizedPct,
 *   annualizedVolatilityPct, metrics: { mse, rmse, mae }, residuals
 * }
 */
export function forecast({ values = [], horizon = 7, alpha = 0.4, beta = 0.2, confidence = 1.645, periodsPerYear = 365 } = {}) {
    const clean = values.filter(v => typeof v === 'number' && Number.isFinite(v)).map(Number);
    if (clean.length === 0) {
        return {
            fitted: [], future: [], lastLevel: null, lastTrend: 0,
            trendPerPeriodPct: 0, trendAnnualizedPct: 0, annualizedVolatilityPct: 0,
            metrics: { mse: 0, rmse: 0, mae: 0 }, residuals: [],
        };
    }

    const fit = holtLinear(clean, { alpha, beta });

    // Volatility on period-over-period changes (return-like), annualized.
    const changes = clean.slice(1).map((v, i) => v - clean[i]);
    const volPct = Math.sqrt(ewmaVariance(changes)) * Math.sqrt(periodsPerYear);

    const future = [];
    let base = fit.lastLevel;
    for (let h = 1; h <= horizon; h++) {
        const value = base + h * fit.lastTrend;
        // Uncertainty grows with sqrt(horizon); band widens around the point.
        const width = confidence * fit.rmse * Math.sqrt(h);
        future.push({ step: h, value: round3(value), upper: round3(value + width), lower: round3(value - width) });
    }

    return {
        fitted: clean.map((v, i) => ({ i, value: round3(v), forecast: round3(fit.fitted[i]) })),
        future,
        lastLevel: round3(fit.lastLevel),
        lastTrend: round3(fit.lastTrend),
        trendPerPeriodPct: round3(fit.lastTrend),
        trendAnnualizedPct: round3(fit.lastTrend * periodsPerYear),
        annualizedVolatilityPct: round3(volPct),
        metrics: { mse: round3(fit.mse), rmse: round3(fit.rmse), mae: round3(fit.mae) },
        residuals: fit.residuals.map(round3),
    };
}

function round3(n) {
    return Math.round(n * 1000) / 1000;
}