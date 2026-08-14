import { describe, it, expect } from 'vitest';
import {
    TOOLS, listToolDefinitions, getTool, validateToolArgs,
    compactMarketData, sampleSeries, compactMemory, compactBacktest,
} from '../../core/tools/registry.js';

describe('tool registry (B3-1)', () => {
    it('defines the six read-only tools', () => {
        const names = TOOLS.map(t => t.name);
        expect(names).toEqual([
            'get_market_snapshot',
            'get_portfolio',
            'get_historical_yields',
            'get_recent_memories',
            'run_backtest',
            'get_agent_logs',
        ]);
        for (const tool of TOOLS) {
            expect(tool.description).toBeTruthy();
            expect(typeof tool.handler).toBe('function');
        }
    });

    it('exposes OpenAI-compatible tool definitions', () => {
        const defs = listToolDefinitions();
        expect(defs).toHaveLength(6);
        for (const def of defs) {
            expect(def.type).toBe('function');
            expect(def.function.name).toBeTruthy();
            expect(def.function.parameters.type).toBe('object');
        }
        const backtest = defs.find(d => d.function.name === 'run_backtest');
        expect(backtest.function.parameters.required).toContain('rangeDays');
        expect(backtest.function.parameters.properties.leverage.maximum).toBe(10);
        const snapshot = defs.find(d => d.function.name === 'get_market_snapshot');
        expect(snapshot.function.parameters).toEqual({
            $schema: 'https://json-schema.org/draft/2020-12/schema',
            type: 'object',
            properties: {},
            additionalProperties: false,
        });
    });

    it('getTool returns the tool or null', () => {
        expect(getTool('run_backtest')).toBeTruthy();
        expect(getTool('not_a_tool')).toBeNull();
    });

    it('accepts valid args and applies defaults', () => {
        const res = validateToolArgs('run_backtest', { leverage: 3 });
        expect(res.ok).toBe(true);
        expect(res.args).toEqual({ leverage: 3, rangeDays: 90 });
    });

    it('rejects out-of-range args with issues', () => {
        const res = validateToolArgs('run_backtest', { leverage: 0 });
        expect(res.ok).toBe(false);
        expect(res.issues.length).toBeGreaterThan(0);
        expect(res.issues[0].path).toBe('leverage');
    });

    it('rejects non-numeric args', () => {
        const res = validateToolArgs('get_recent_memories', { limit: 'five' });
        expect(res.ok).toBe(false);
    });

    it('rejects unknown tools', () => {
        const res = validateToolArgs('fake_tool', {});
        expect(res.ok).toBe(false);
    });

    it('compactMarketData projects the LLM-relevant subset', () => {
        const md = {
            ethPrice: 3500, usdcPrice: 1, susdePrice: 1,
            susdeApy: 12.5, pendlePtSusdeApy: 14, morphoBorrowApy: 8, aaveV4BorrowApy: 7.5,
            bestBorrowApy: 7.5, hyperliquidFundingApy: 9, jitLiquidityApy: 3,
            netApy: 6.1, baseSpread: 4.5, leverage: 4, gasPrice: 8,
            oracleStatus: 'LIVE',
            crossChain: { crossChainSavings: 0.8, isCrossChainArbitrageAvailable: false, crossChainNetwork: 'Base (Aave V3)', minViableTvl: 50000 },
            points: { morphoPointsApy: 2, enaPointsApy: 1, borosFundingYield: 0.5, totalPointsApy: 1.5 },
            portfolio: {
                tvl: 100000, healthFactor: 2.1, currentLtv: 0.75,
                currentCollateral: 'sUSDe', allocations: { loop: 1, basis: 0, jit: 0 },
                deployedCapital: 50000, activeChain: 'Ethereum', activeProtocol: 'Morpho Blue',
                strategies: [{ name: 'loop', status: 'ACTIVE', apy: 6 }, { name: 'basis', status: 'PAUSED' }],
            },
            internalFlag: 'should-not-leak',
        };
        const out = compactMarketData(md);
        expect(out.oracleStatus).toBe('LIVE');
        expect(out.yields.netApy).toBe(6.1);
        expect(out.portfolio.activeStrategies).toBe(1);
        expect(out.crossChain.crossChainNetwork).toBe('Base (Aave V3)');
        expect(out.points.totalPointsApy).toBe(1.5);
        expect(out.internalFlag).toBeUndefined();
    });

    it('sampleSeries downsamples long series evenly', () => {
        const points = Array.from({ length: 100 }, (_, i) => ({ i }));
        const out = sampleSeries(points, 30);
        expect(out).toHaveLength(30);
        expect(out[0].i).toBe(0);
        expect(out[29].i).toBe(96); // 100/30 step → last sampled index
    });

    it('sampleSeries passes through short series untouched', () => {
        const points = [{ a: 1 }, { a: 2 }];
        expect(sampleSeries(points, 30)).toEqual(points);
        expect(sampleSeries([], 30)).toEqual([]);
    });

    it('compactMemory parses stored snapshots', () => {
        const row = {
            id: 7,
            action_taken: 'adjust_portfolio',
            is_successful: 1,
            profit_loss: -1.2,
            created_at: '2026-08-13T10:00:00.000Z',
            market_state_json: JSON.stringify({
                netApy: 5, baseSpread: 3, leverage: 4,
                portfolio: { tvl: 90000, healthFactor: 1.9 },
            }),
        };
        const out = compactMemory(row);
        expect(out.id).toBe(7);
        expect(out.actionTaken).toBe('adjust_portfolio');
        expect(out.isSuccessful).toBe(true);
        expect(out.marketSummary.portfolio.healthFactor).toBe(1.9);
    });

    it('compactMemory tolerates malformed JSON', () => {
        const row = { id: 1, action_taken: 'hold', is_successful: 0, profit_loss: 0, market_state_json: '{broken' };
        const out = compactMemory(row);
        expect(out.marketSummary).toBeNull();
        expect(out.isSuccessful).toBe(false);
    });

    it('compactBacktest strips the full equity curve', () => {
        const bt = {
            strategy: 'loop', rangeDays: 90, leverage: 4, days: 90,
            totalReturn: 6.54321, cagr: 7.87654, sharpe: 1.23456, maxDrawdown: -8.98765,
            liquidationPriceAtLeverage: 0.8, startDate: 'd1', endDate: 'd90',
            last: { date: 'd90', susdeApy: 12, borrowApy: 8, loopNetApy: 4 },
            monthly: [{ m: 1, ret: 1 }, { m: 2, ret: 2 }],
            equityCurve: Array.from({ length: 5000 }, () => ({ date: 'x', equity: 1 })),
        };
        const out = compactBacktest(bt);
        expect(out.equityCurve).toBeUndefined();
        expect(out.totalReturnPct).toBe(6.54);
        expect(out.monthly).toHaveLength(2);
    });

    it('compactBacktest surfaces backtester errors', () => {
        expect(compactBacktest({ error: 'Not enough historical data to backtest.', days: 3 })).toEqual({
            error: 'Not enough historical data to backtest.',
            days: 3,
        });
    });
});
