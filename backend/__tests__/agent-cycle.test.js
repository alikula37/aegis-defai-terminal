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
    getSettings: vi.fn(async () => ({ openRouterKey: '', activeModel: 'test', targetHf: 1.25, maxGasClaim: 20, llmToolsEnabled: false })),
}));

vi.mock('../services/HistoricalDataService.js', () => ({
    HistoricalDataService: { recordSnapshot: vi.fn() },
}));

vi.mock('../services/LLMService.js', () => ({
    callLLM: vi.fn(),
    callLLMWithTools: vi.fn(),
}));

import { MarketDataSource } from '../core/data/MarketDataSource.js';
import { callLLM } from '../services/LLMService.js';
import { insertPortfolioStats, insertMemory } from '../db/database.js';
import { AegisAgent } from '../agent.js';
import aegisConfig from '../aegis.config.js';

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

function makeAgent(broadcast) {
    return new AegisAgent(broadcast);
}

describe('AegisAgent.runCycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setRngSeed(2026);
    });

    it('holds without calling the LLM when conditions are optimal', async () => {
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData({ gasPrice: 25 }));
        const logs = [];
        const agent = makeAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        agent.isRunning = true;

        await agent.runCycle();

        expect(callLLM).not.toHaveBeenCalled();
        expect(logs.some(l => l.broadcastType === 'agent_log' && /Scanning Pendle/.test(l.message))).toBe(true);
        expect(insertPortfolioStats).toHaveBeenCalled();
    });

    it('falls back to deterministic rescue when the LLM errors in critical conditions', async () => {
        // negative spread → isCritical
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData({ baseSpread: -2 }));
        callLLM.mockRejectedValue(new Error('OpenRouter API Error: timeout'));
        const logs = [];
        const agent = makeAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        agent.isRunning = true;

        await agent.runCycle();

        // flash_loan rescue decision executed via SimulationExecution
        expect(logs.some(l => l.type === 'flash_loan')).toBe(true);
        expect(insertMemory).toHaveBeenCalledWith(expect.anything(), 'flash_loan_rescue', true, expect.any(Number), null, expect.any(Object));
        // a notification about the API error was broadcast
        expect(logs.some(l => l.broadcastType === 'notification' && /OpenRouter API Error/.test(l.message))).toBe(true);

        // settle the flash_loan handler's 3s settlement timer so it cannot
        // leak into subsequent tests
        await new Promise(r => setTimeout(r, 3200));
    });

    it('executes a decision the LLM produces successfully', async () => {
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData());
        callLLM.mockResolvedValue({ decision: 'claim', reasoning: 'profit', action: 'Claiming rewards' });
        const logs = [];
        const agent = makeAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        agent.isRunning = true;

        await agent.runCycle();

        expect(logs.some(l => l.type === 'claim')).toBe(true);
        expect(callLLM).toHaveBeenCalled();
    });

    it('aborts execution when the fresh snapshot drifted by more than 0.05 HF', async () => {
        const fresh = makeMarketData({ portfolio: { ...makeMarketData().portfolio, healthFactor: 1.35 } });
        MarketDataSource.getSnapshot
            .mockResolvedValueOnce(makeMarketData())
            .mockResolvedValueOnce(fresh);
        callLLM.mockResolvedValue({ decision: 'claim', reasoning: 'profit', action: 'Claiming rewards' });
        const logs = [];
        const agent = makeAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        agent.isRunning = true;

        await agent.runCycle();

        expect(logs.some(l => /Slippage Check/.test(l.message))).toBe(true);
        expect(insertMemory).not.toHaveBeenCalled();
    });

    it('logs an alert and skips the cycle when oracle data is unavailable', async () => {
        MarketDataSource.getSnapshot.mockRejectedValue(new Error('network down'));
        const logs = [];
        const agent = makeAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        agent.isRunning = true;

        await agent.runCycle();

        expect(logs.some(l => l.broadcastType === 'agent_log' && /Oracle API Error/.test(l.message))).toBe(true);
        expect(insertPortfolioStats).not.toHaveBeenCalled();
    });
});

describe('AegisAgent cycle watchdog (B2.5-7)', () => {
    it('broadcasts a watchdog alert when the cycle exceeds the threshold', async () => {
        aegisConfig.agent.cycleWatchdogMs = 20; // shrink threshold for the test
        // A slow snapshot (80ms) vs a 20ms watchdog → the alert fires mid-cycle
        MarketDataSource.getSnapshot.mockImplementation(async () => {
            await new Promise(r => setTimeout(r, 80));
            return makeMarketData();
        });
        callLLM.mockResolvedValue({ decision: 'hold', reasoning: 'ok', action: 'nothing' });
        const logs = [];
        const agent = new AegisAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        agent.isRunning = true;

        await agent.runCycle();

        expect(logs.some(l => l.broadcastType === 'agent_log' && /Watchdog/.test(l.message))).toBe(true);
    });

    it('does not raise the watchdog alert for fast cycles', async () => {
        aegisConfig.agent.cycleWatchdogMs = 20;
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData());
        callLLM.mockResolvedValue({ decision: 'hold', reasoning: 'ok', action: 'nothing' });
        const logs = [];
        const agent = new AegisAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        agent.isRunning = true;

        await agent.runCycle();

        expect(logs.some(l => /Watchdog/.test(l.message))).toBe(false);
    });
});
