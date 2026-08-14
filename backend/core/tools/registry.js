// backend/core/tools/registry.js
// Faz 3 (B3-1) — Read-only tool definitions for the LLM decision cycle.
//
// Every tool is PURE DATA: handlers may only read state / compute metrics,
// never mutate the portfolio or broadcast transactions. Execution authority
// stays with the agent's guardrail chain (RiskEngine + validateLLMDecision).
// Dependencies are injected via ctx so the registry stays unit-testable.

import { z } from 'zod';
import config from '../../aegis.config.js';

const intParam = (min, max) => z.number().int().min(min).max(max).describe(`integer between ${min} and ${max}`);

/**
 * Compact projection of the live snapshot — the exact subset an LLM needs
 * to reason about risk/yield, with token-heavy internals removed.
 */
function compactPortfolio(marketData) {
    const portfolio = marketData.portfolio;
    return {
        tvl: portfolio?.tvl ?? null,
        healthFactor: portfolio?.healthFactor ?? null,
        currentLtv: portfolio?.currentLtv ?? null,
        currentCollateral: portfolio?.currentCollateral ?? null,
        allocations: portfolio?.allocations ?? null,
        deployedCapital: portfolio?.deployedCapital ?? null,
        activeChain: portfolio?.activeChain ?? null,
        activeProtocol: portfolio?.activeProtocol ?? null,
        activeStrategies: portfolio?.strategies
            ? portfolio.strategies.filter(s => s.status === 'ACTIVE').length
            : null,
    };
}

function compactCrossChain(crossChain) {
    if (!crossChain) return null;
    return {
        crossChainSavings: crossChain.crossChainSavings ?? null,
        isCrossChainArbitrageAvailable: crossChain.isCrossChainArbitrageAvailable ?? null,
        crossChainNetwork: crossChain.crossChainNetwork ?? null,
        minViableTvl: crossChain.minViableTvl ?? null,
    };
}

function compactPoints(points) {
    if (!points) return null;
    return {
        morphoPointsApy: points.morphoPointsApy ?? null,
        enaPointsApy: points.enaPointsApy ?? null,
        borosFundingYield: points.borosFundingYield ?? null,
        totalPointsApy: points.totalPointsApy ?? null,
    };
}

export function compactMarketData(marketData) {
    if (!marketData) return { error: 'No market data available' };
    return {
        oracleStatus: marketData.oracleStatus ?? 'unknown',
        prices: {
            eth: marketData.ethPrice ?? null,
            usdc: marketData.usdcPrice ?? null,
            susde: marketData.susdePrice ?? null,
        },
        yields: {
            susdeApy: marketData.susdeApy ?? null,
            pendlePtSusdeApy: marketData.pendlePtSusdeApy ?? null,
            morphoBorrowApy: marketData.morphoBorrowApy ?? null,
            aaveV4BorrowApy: marketData.aaveV4BorrowApy ?? null,
            bestBorrowApy: marketData.bestBorrowApy ?? null,
            hyperliquidFundingApy: marketData.hyperliquidFundingApy ?? null,
            jitLiquidityApy: marketData.jitLiquidityApy ?? null,
            netApy: marketData.netApy ?? null,
            baseSpread: marketData.baseSpread ?? null,
            leverage: marketData.leverage ?? null,
            gasPriceGwei: marketData.gasPrice ?? null,
        },
        portfolio: compactPortfolio(marketData),
        crossChain: compactCrossChain(marketData.crossChain),
        points: compactPoints(marketData.points),
    };
}

/**
 * Downsample a time series so LLM context stays small (max maxPoints, evenly spaced).
 */
export function sampleSeries(points, maxPoints = 30) {
    if (!Array.isArray(points) || points.length === 0) return [];
    if (points.length <= maxPoints) return points;
    const step = points.length / maxPoints;
    const out = [];
    for (let i = 0; i < maxPoints; i++) {
        out.push(points[Math.floor(i * step)]);
    }
    return out;
}

/** Compact view of a decision memory row. */
export function compactMemory(row) {
    if (!row) return null;
    let marketSummary = null;
    try {
        const parsed = typeof row.market_state_json === 'string' ? JSON.parse(row.market_state_json) : row.market_state_json;
        if (parsed && parsed.portfolio) {
            marketSummary = compactMarketData(parsed);
        } else if (parsed && typeof parsed === 'object') {
            marketSummary = {
                hf: parsed.healthFactor ?? null,
                netApy: parsed.netApy ?? null,
                tvl: parsed.tvl ?? null,
                spread: parsed.baseSpread ?? null,
            };
        }
    } catch {
        marketSummary = null;
    }
    return {
        id: row.id,
        actionTaken: row.action_taken,
        isSuccessful: Boolean(row.is_successful),
        profitLoss: row.profit_loss,
        createdAt: row.created_at,
        marketSummary,
        reasoning: parseReasoningDetails(row.details_json),
    };
}

/** Parse persisted reasoning details (decision_memory.details_json). */
function parseReasoningDetails(raw) {
    if (!raw) return null;
    try {
        const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (parsed && typeof parsed === 'object' && parsed.situation && parsed.chosen) {
            return {
                situation: parsed.situation,
                analysis: parsed.analysis ?? null,
                alternatives: parsed.alternatives ?? null,
                chosen: parsed.chosen,
            };
        }
        return null;
    } catch {
        return null;
    }
}

/** Compact view of an agent log row. */
export function compactLog(row) {
    if (!row) return null;
    return {
        id: row.id,
        level: row.level,
        type: row.type,
        message: typeof row.message === 'string' ? row.message.slice(0, 300) : row.message,
        timestamp: row.timestamp,
    };
}

/** Compact backtest result — strips the full equity curve (too many tokens). */
export function compactBacktest(result) {
    if (!result) return { error: 'Backtest returned no result' };
    if (result.error) return { error: result.error, days: result.days ?? null };
    return {
        strategy: result.strategy,
        rangeDays: result.rangeDays,
        leverage: result.leverage,
        days: result.days,
        totalReturnPct: Number(result.totalReturn?.toFixed(2) ?? null),
        cagrPct: Number(result.cagr?.toFixed(2) ?? null),
        sharpe: Number(result.sharpe?.toFixed(2) ?? null),
        maxDrawdownPct: Number(result.maxDrawdown?.toFixed(2) ?? null),
        liquidationPriceAtLeverage: result.liquidationPriceAtLeverage ?? null,
        startDate: result.startDate ?? null,
        endDate: result.endDate ?? null,
        last: result.last ?? null,
        monthly: (result.monthly || []).slice(-6),
    };
}

export const TOOLS = [
    {
        name: 'get_market_snapshot',
        description: 'Current live market snapshot: prices, APYs, borrow rates, spread, leverage, gas price, cross-chain arbitrage opportunity and points yields. Read-only.',
        schema: z.object({}),
        handler: async (ctx) => compactMarketData(ctx.marketData),
    },
    {
        name: 'get_portfolio',
        description: 'Current portfolio state: TVL, health factor, LTV, collateral type, allocations, active chain/protocol and active strategy count. Read-only.',
        schema: z.object({}),
        handler: async (ctx) => {
            const md = ctx.marketData;
            if (!md?.portfolio) return { error: 'No portfolio data available' };
            return {
                tvl: md.portfolio.tvl,
                netApy: md.portfolio.netApy,
                healthFactor: md.portfolio.healthFactor,
                currentLtv: md.portfolio.currentLtv,
                currentCollateral: md.portfolio.currentCollateral,
                allocations: md.portfolio.allocations,
                deployedCapital: md.portfolio.deployedCapital,
                activeChain: md.portfolio.activeChain,
                activeProtocol: md.portfolio.activeProtocol,
                strategies: (md.portfolio.strategies || []).map(s => ({
                    name: s.name,
                    status: s.status,
                    allocation: s.allocation ?? null,
                    apy: s.apy ?? null,
                })),
            };
        },
    },
    {
        name: 'get_historical_yields',
        description: 'Historical daily APY series for the sUSDe pool (DefiLlama). Returns up to 30 evenly spaced points. Read-only.',
        schema: z.object({
            rangeDays: intParam(7, 365).default(90),
        }),
        handler: async (ctx, { rangeDays }) => {
            if (!ctx.historicalService) return { error: 'Historical data service not available' };
            const poolId = config.marketData.pools.susde;
            const points = await ctx.historicalService.getPoolApyHistory(poolId, 'susde', rangeDays);
            return {
                poolId,
                rangeDays,
                points: sampleSeries(points, 30),
            };
        },
    },
    {
        name: 'get_recent_memories',
        description: 'Recent agent decisions and their outcomes (up to limit rows, newest first). Useful to learn from past mistakes. Read-only.',
        schema: z.object({
            limit: intParam(1, 20).default(5),
        }),
        handler: async (ctx, { limit }) => {
            if (!ctx.getRecentMemories) return { error: 'Memory service not available' };
            const rows = await ctx.getRecentMemories(limit, ctx.simulationId);
            return rows.map(compactMemory);
        },
    },
    {
        name: 'run_backtest',
        description: 'Backtest the delta-neutral loop strategy on real historical data (sUSDe APY vs Morpho borrow). Returns returns, Sharpe, max drawdown and liquidation price. Read-only computation.',
        schema: z.object({
            leverage: intParam(1, 10).default(4),
            rangeDays: intParam(7, 365).default(90),
        }),
        handler: async (ctx, { leverage, rangeDays }) => {
            if (!ctx.backtester) return { error: 'Backtester not available' };
            const result = await ctx.backtester.runBacktest({ leverage, rangeDays });
            return compactBacktest(result);
        },
    },
    {
        name: 'get_agent_logs',
        description: 'Recent agent activity logs (alerts, decisions, errors). Useful to understand what the agent has been doing. Read-only.',
        schema: z.object({
            limit: intParam(1, 50).default(10),
        }),
        handler: async (ctx, { limit }) => {
            if (!ctx.getLogs) return { error: 'Log service not available' };
            const rows = await ctx.getLogs(limit, 0, 'All', ctx.simulationId);
            return rows.map(compactLog);
        },
    },
];

const registry = new Map(TOOLS.map(t => [t.name, t]));

/** OpenAI-compatible tool definitions (for OpenRouter `tools` parameter). */
export function listToolDefinitions() {
    return TOOLS.map(t => ({
        type: 'function',
        function: {
            name: t.name,
            description: t.description,
            parameters: z.toJSONSchema(t.schema),
        },
    }));
}

export function getTool(name) {
    return registry.get(name) || null;
}

/**
 * Validate raw (LLM-provided) args against the tool's zod schema.
 * Returns { ok: true, args } or { ok: false, issues }.
 */
export function validateToolArgs(name, rawArgs) {
    const tool = getTool(name);
    if (!tool) return { ok: false, issues: [{ message: `Unknown tool: ${name}` }] };
    const args = rawArgs === undefined ? {} : rawArgs;
    const parsed = tool.schema.safeParse(args);
    if (!parsed.success) {
        return {
            ok: false,
            issues: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
        };
    }
    return { ok: true, args: parsed.data };
}
