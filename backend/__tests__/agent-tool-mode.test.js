import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setRngSeed } from '../utils/rng.js';

vi.mock('../core/data/MarketDataSource.js', () => ({
    MarketDataSource: { getSnapshot: vi.fn() },
}));

vi.mock('../db/database.js', () => ({
    insertLog: vi.fn(),
    insertPortfolioStats: vi.fn(() => ({ tvl: 0, netApy: 0, healthFactor: 0 })),
    getLatestPortfolio: vi.fn(async () => ({ tvl: 10000, net_apy: 15, health_factor: 1.5 })),
    insertMemory: vi.fn(),
    getRecentMemories: vi.fn(async () => []),
    resetPortfolio: vi.fn(),
    getLogs: vi.fn(async () => []),
    getSettings: vi.fn(async () => ({ openRouterKey: '', activeModel: 'test', targetHf: 1.25, maxGasClaim: 20, llmToolsEnabled: true })),
}));

vi.mock('../services/HistoricalDataService.js', () => ({
    HistoricalDataService: { recordSnapshot: vi.fn() },
}));

// Inline mock — importing the real module here would run dotenv.config() and
// leak backend/.env (EVM_PROVIDER_URL) into the test process.
vi.mock('../services/LLMService.js', () => {
    class LLMUnavailableError extends Error {
        constructor(message, { reason = 'no-key' } = {}) {
            super(message);
            this.name = 'LLMUnavailableError';
            this.reason = reason;
        }
    }
    return {
        callLLM: vi.fn(),
        callLLMWithTools: vi.fn(),
        LLMUnavailableError,
        isPaymentRequiredError: (error) => !!error && typeof error.status === 'number' && error.status === 402,
        hasValidApiKey: (settings = {}) => Boolean(settings.openRouterKey) && settings.openRouterKey !== 'kullanici_buraya_girecek',
        getApiKey: (settings = {}) => {
            if (!settings.openRouterKey) throw new LLMUnavailableError('OpenRouter API Key is missing or invalid.', { reason: 'no-key' });
            return settings.openRouterKey;
        },
    };
});

import { MarketDataSource } from '../core/data/MarketDataSource.js';
import { callLLM, callLLMWithTools } from '../services/LLMService.js';
import { insertLog, getSettings } from '../db/database.js';
import { ToolExecutor } from '../core/tools/executor.js';
import { AegisAgent } from '../agent.js';

const DEFAULT_SETTINGS = { openRouterKey: '', activeModel: 'test', targetHf: 1.25, maxGasClaim: 20, llmToolsEnabled: true };

function makeMarketData(overrides = {}) {
    return {
        ethPrice: 2500,
        usdcPrice: 1,
        susdePrice: 1,
        susdeApy: 4.5,
        pendlePtSusdeApy: 5.2,
        morphoBorrowApy: 4.8,
        aaveV4BorrowApy: 4.0,
        bestBorrowApy: 4.8,
        baseSpread: 0.4,
        leverage: 5,
        netApy: 3.2,
        gasPrice: 15,
        blockNumber: 12345,
        oracleStatus: 'LIVE',
        hyperliquidFundingApy: 10,
        jitLiquidityApy: 30,
        points: { totalPointsApy: 2 },
        crossChain: { isCrossChainArbitrageAvailable: false, minViableTvl: 50000, crossChainNetwork: 'Base', bestCrossChainBorrowApy: 4, crossChainSavings: 0, bridgeCostUsd: 25 },
        portfolio: {
            tvl: 10000,
            netApy: 3.2,
            healthFactor: 1.5,
            currentLtv: 0.8,
            currentCollateral: 'PT-sUSDe',
            allocations: { loop: 1, basis: 0, jit: 0 },
            strategies: [],
        },
        ...overrides,
    };
}

function toolCall(name, args = '{}') {
    return { id: `call_${Math.random().toString(36).slice(2, 8)}`, type: 'function', function: { name, arguments: args } };
}

function finalDecision(decision = 'claim') {
    return { content: JSON.stringify({ decision, reasoning: 'data-driven', action: 'Tool decision' }), toolCalls: [] };
}

describe('AegisAgent tool-calling mode (B3-8)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setRngSeed(2026);
        callLLMWithTools.mockReset();
        callLLM.mockReset();
        getSettings.mockReset();
        getSettings.mockImplementation(async () => ({ ...DEFAULT_SETTINGS }));
    });

    it('runs the tool loop end-to-end and executes the final decision', async () => {
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData());
        callLLMWithTools
            .mockResolvedValueOnce({ content: null, toolCalls: [toolCall('get_market_snapshot')] })
            .mockResolvedValueOnce(finalDecision('claim'));

        const logs = [];
        const agent = new AegisAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        agent.isRunning = true;

        await agent.runCycle();

        // The LLM saw real tool data before deciding
        expect(callLLMWithTools).toHaveBeenCalledTimes(2);
        expect(callLLM).not.toHaveBeenCalled();
        // The tool result was fed back as a 'tool' role message
        const round2 = callLLMWithTools.mock.calls[1][0];
        expect(round2.toolMessages.some(m => m.role === 'tool')).toBe(true);
        expect(round2.toolMessages.some(m => m.role === 'assistant' && m.tool_calls)).toBe(true);
        // Decision executed
        expect(logs.some(l => l.type === 'claim')).toBe(true);
    });

    it('persists an audit trail for every tool call', async () => {
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData());
        callLLMWithTools
            .mockResolvedValueOnce({ content: null, toolCalls: [toolCall('get_market_snapshot')] })
            .mockResolvedValueOnce(finalDecision('hold'));

        const agent = new AegisAgent(() => {});
        agent.isRunning = true;
        await agent.runCycle();

        const toolLogs = insertLog.mock.calls.filter(c => c[1] === 'tool');
        expect(toolLogs.length).toBeGreaterThan(0);
        expect(toolLogs[0][0]).toBe('info');
        expect(toolLogs[0][2]).toMatch(/get_market_snapshot ok/);
        expect(toolLogs[0][3]).toHaveProperty('args');
    });

    it('caps the loop at maxRounds when the LLM never stops calling tools', async () => {
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData());
        callLLMWithTools.mockResolvedValue({ content: null, toolCalls: [toolCall('get_market_snapshot')] });

        const logs = [];
        const agent = new AegisAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        agent.isRunning = true;

        await agent.runCycle();

        // 3 rounds max, then a fallback decision (no crash, no hang)
        expect(callLLMWithTools).toHaveBeenCalledTimes(3);
        expect(logs.some(l => l.broadcastType === 'notification' && /OpenRouter API Error/.test(l.message))).toBe(true);
        // The agent still produced a deterministic decision and finished
        expect(logs.some(l => l.broadcastType === 'agent_log')).toBe(true);
    });

    it('stops tool calls once the executor budget is exhausted', async () => {
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData());
        callLLMWithTools.mockResolvedValue({ content: null, toolCalls: [toolCall('get_market_snapshot')] });

        const executor = new ToolExecutor({ maxCallsPerCycle: 2 });
        const agent = new AegisAgent(() => {}, { toolExecutor: executor });
        agent.isRunning = true;

        await agent.runCycle();

        // Budget of 2 → loop broke before round 3; both calls consumed
        expect(callLLMWithTools).toHaveBeenCalledTimes(2);
        expect(executor.callsUsed).toBe(2);
        expect(executor.callsRemaining).toBe(0);
    });

    it('falls back to the plain prompt path when tool mode is disabled', async () => {
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData());
        callLLM.mockResolvedValue({ decision: 'claim', reasoning: 'profit', action: 'Claiming rewards' });
        getSettings.mockResolvedValue({ ...DEFAULT_SETTINGS, llmToolsEnabled: false });

        const logs = [];
        const agent = new AegisAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        agent.isRunning = true;

        await agent.runCycle();

        expect(callLLM).toHaveBeenCalled();
        expect(callLLMWithTools).not.toHaveBeenCalled();
        expect(logs.some(l => l.type === 'claim')).toBe(true);
    });

    it('invalid tool args are reported to the LLM as structured tool errors', async () => {
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData());
        callLLMWithTools
            .mockResolvedValueOnce({ content: null, toolCalls: [toolCall('run_backtest', '{"leverage":99}')] })
            .mockResolvedValueOnce(finalDecision('hold'));

        const agent = new AegisAgent(() => {});
        agent.isRunning = true;
        await agent.runCycle();

        const round2 = callLLMWithTools.mock.calls[1][0];
        const toolMsg = round2.toolMessages.find(m => m.role === 'tool');
        expect(JSON.parse(toolMsg.content).error).toBe('invalid_args');
    });
});
