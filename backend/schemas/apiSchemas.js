// ---- API response contracts (zod) ----
// The shapes the backend promises to return. Contract tests in server.test.js
// validate live responses against these, and the OpenAPI spec
// (api/openapi.json) is generated to match. Kept in one module so the
// contract, the tests and the docs can never drift.

import { z } from 'zod';

// Loose numeric tolerances: backend values are floats, frontends are tolerant.
const num = () => z.union([z.number(), z.string()]).optional().nullable();

export const errorResponseSchema = z.object({
    error: z.string(),
});

export const healthSchema = z.object({
    status: z.string(),
});

export const metricsSchema = z.object({
    httpRequests: z.number().optional(),
});

export const settingsSchema = z.object({
    targetHf: num(),
    warningHf: num(),
    criticalHf: num(),
    dataMode: z.enum(['SIM', 'LIVE']).optional(),
    dataScenario: z.string().optional(),
    hasOpenRouterKey: z.boolean().optional(),
    hasRpcUrl: z.boolean().optional(),
    openRouterKey: z.string().optional(),
    rpcUrl: z.string().optional(),
}).passthrough();

export const strategySchema = z.object({
    name: z.string(),
    protocol: z.string().optional(),
    apy: num(),
    tvl: num(),
    status: z.string().optional(),
    risk: z.string().optional(),
}).passthrough();

export const portfolioSchema = z.object({
    ethPrice: num(),
    susdePrice: num(),
    susdeApy: num(),
    pendlePtSusdeApy: num(),
    morphoBorrowApy: num(),
    baseSpread: num(),
    leverage: num(),
    netApy: num(),
    gasPrice: num(),
    tvl: num(),
    healthFactor: num(),
    oracleStatus: z.string(),
    strategies: z.array(strategySchema).optional(),
    points: z.object({ totalPointsApy: num() }).passthrough().optional(),
    crossChain: z.object({ isCrossChainArbitrageAvailable: z.boolean().optional() }).passthrough().optional(),
}).passthrough();

export const portfolioHistoryRowSchema = z.object({
    id: z.number().optional(),
    simulation_id: z.string().optional(),
    timestamp: z.string(),
    tvl: num(),
    net_apy: num().nullable(),
    health_factor: num().nullable(),
}).passthrough();

export const riskMetricsSchema = z.object({
    periods: z.number(),
    meanDailyReturnPct: z.number(),
    meanAnnualReturnPct: z.number(),
    annualizedVolatilityPct: z.number(),
    sharpeRatio: z.number(),
    sortinoRatio: z.number(),
    maxDrawdownPct: z.number(),
    historicalVaRPct: z.number(),
    parametricVaRPct: z.number(),
    conditionalVaRPct: z.number(),
    winRate: z.number(),
    beta: z.number().nullable(),
    confidence: z.number(),
}).passthrough();

export const forecastSchema = z.object({
    metric: z.string(),
    fitted: z.array(z.object({ i: z.number(), value: z.number(), forecast: z.number() })),
    future: z.array(z.object({ step: z.number(), value: z.number(), upper: z.number(), lower: z.number() })),
    lastLevel: z.number().nullable(),
    lastTrend: z.number(),
    trendPerPeriodPct: z.number(),
    trendAnnualizedPct: z.number(),
    annualizedVolatilityPct: z.number(),
    metrics: z.object({ mse: z.number(), rmse: z.number(), mae: z.number() }),
}).passthrough();

export const backtestSchema = z.object({
    strategy: z.string(),
    days: z.number(),
    totalReturn: z.number(),
    cagr: z.number(),
    sharpe: z.number(),
    maxDrawdown: z.number(),
    sortino: z.number(),
    vaR95Pct: z.number(),
    winRate: z.number(),
    bootstrap: z.object({ lo95: z.number(), hi95: z.number(), meanCagr: z.number() }).passthrough(),
    outOfSample: z.object({ testCagr: z.number(), testDays: z.number() }).passthrough().nullable(),
}).passthrough();

export const monteCarloSchema = z.object({
    simulations: z.number(),
    liquidationProbability: z.number(),
    medianReturnPct: z.number(),
    p5ReturnPct: z.number(),
    p95ReturnPct: z.number(),
}).passthrough();

export const simulationStatusSchema = z.object({
    isRunning: z.boolean(),
    startTime: z.number().nullable().optional(),
    execution: z.object({}).passthrough().optional(),
}).passthrough();

export const logRowSchema = z.object({
    type: z.string(),
    message: z.string(),
    timestamp: z.string(),
    simulation_id: z.string().optional(),
}).passthrough();

export const simulationStartResponseSchema = z.object({
    success: z.boolean(),
    simulationId: z.string().optional(),
    initialBalance: z.union([z.number(), z.string()]).optional(),
}).passthrough();

export const apiSchemas = {
    errorResponse: errorResponseSchema,
    health: healthSchema,
    metrics: metricsSchema,
    settings: settingsSchema,
    portfolio: portfolioSchema,
    portfolioHistoryRow: portfolioHistoryRowSchema,
    riskMetrics: riskMetricsSchema,
    forecast: forecastSchema,
    backtest: backtestSchema,
    monteCarlo: monteCarloSchema,
    simulationStatus: simulationStatusSchema,
    logRow: logRowSchema,
    simulationStartResponse: simulationStartResponseSchema,
};

/** Assert an API payload conforms to a schema; returns the parsed value. */
export function assertContract(schema, payload) {
    const result = schema.safeParse(payload);
    if (!result.success) {
        const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
        throw new Error(`API contract violation: ${issues}`);
    }
    return result.data;
}