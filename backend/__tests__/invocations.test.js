import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Invocation tests: the RIGHT functions are called with the RIGHT args ----
// Unit tests usually assert return values; these assert that the orchestration
// layer wires the components together correctly (calls, ordering, payloads).

const mockConditions = {
    isCritical: false, isWarning: false, isSafe: true,
    targetHf: 1.25, warningHf: 1.21, criticalHf: 1.15,
    isClaimProfitable: true, maxGasClaim: 20, estimatedClaimProfit: 3, gasCostUsd: 1,
};

// vi.hoisted guarantees the object exists before any vi.mock factory runs
// (factories are hoisted above the const declaration).
const llmMode = vi.hoisted(() => ({ shouldCall: false, canCall: false, throws: false }));

vi.mock('../core/RiskEngine.js', () => ({
    evaluateMarketConditions: vi.fn(() => ({ ...mockConditions })),
}));

vi.mock('../core/DecisionEngine.js', () => ({
    deterministicFallback: vi.fn(() => ({ decision: 'claim', reasoning: 'fallback' })),
    shouldCallLLM: vi.fn(() => llmMode.shouldCall),
    validateLLMDecision: vi.fn((response) => ({ response, warnings: [] })),
    normalizeReasoning: vi.fn((response) => ({ ...response, reasoningDetails: { basis: 'fallback' } })),
    capPromptTokens: vi.fn((p, c, m) => ({ prompt: p, memories: m })),
}));

vi.mock('../core/LLMBudget.js', () => ({
    LLMBudget: class {
        beginCycle() {}
        canCall() { return llmMode.canCall; }
        recordCall() {}
    },
    supportsTools: vi.fn(() => false),
}));

vi.mock('../core/data/MarketDataSource.js', () => ({
    MarketDataSource: { getSnapshot: vi.fn() },
}));

vi.mock('../db/database.js', () => ({
    insertLog: vi.fn(),
    insertPortfolioStats: vi.fn(() => ({ tvl: 10000, netApy: 3.2, healthFactor: 1.5 })),
    getLatestPortfolio: vi.fn(async () => ({ tvl: 10000, net_apy: 3.2, health_factor: 1.5 })),
    insertMemory: vi.fn(),
    getRecentMemories: vi.fn(async () => []),
    resetPortfolio: vi.fn(async () => ({ simulationId: 'inv-1' })),
    getSettings: vi.fn(async () => ({ activeModel: 'test', targetHf: 1.25, maxGasClaim: 20, llmToolsEnabled: false })),
}));

vi.mock('../services/LLMService.js', () => ({
    callLLM: vi.fn(async () => { if (llmMode.throws) throw new Error('OpenRouter outage'); return { decision: 'hold' }; }),
    callLLMWithTools: vi.fn(),
}));

vi.mock('../services/HistoricalDataService.js', () => ({
    HistoricalDataService: { recordSnapshot: vi.fn(), buildBacktestDataset: vi.fn() },
}));

import { MarketDataSource } from '../core/data/MarketDataSource.js';
import { evaluateMarketConditions } from '../core/RiskEngine.js';
import {
    deterministicFallback, shouldCallLLM, validateLLMDecision, normalizeReasoning,
} from '../core/DecisionEngine.js';
import { insertPortfolioStats, getSettings } from '../db/database.js';
import { callLLM } from '../services/LLMService.js';
import { AegisAgent } from '../agent.js';
import { Backtester } from '../backtest/Backtester.js';
import { HistoricalDataService } from '../services/HistoricalDataService.js';

const marketData = {
    ethPrice: 2500, usdcPrice: 1, susdePrice: 1,
    susdeApy: 4.5, pendlePtSusdeApy: 5.2, morphoBorrowApy: 4.8,
    aaveV4BorrowApy: 4.0, bestBorrowApy: 4.8, baseSpread: 0.4,
    leverage: 5, netApy: 3.2, gasPrice: 15, blockNumber: 12345,
    oracleStatus: 'LIVE', hyperliquidFundingApy: 10, jitLiquidityApy: 30,
    points: { totalPointsApy: 2 },
    crossChain: { isCrossChainArbitrageAvailable: false, minViableTvl: 50000, crossChainNetwork: 'Base', bestCrossChainBorrowApy: 4, crossChainSavings: 0, bridgeCostUsd: 25 },
    portfolio: { tvl: 10000, netApy: 3.2, healthFactor: 1.5, currentLtv: 0.8, currentCollateral: 'PT-sUSDe', allocations: { loop: 1, basis: 0, jit: 0 }, strategies: [] },
};

const tick = () => new Promise(r => setTimeout(r, 250));

function makeAgent() {
    return new AegisAgent(() => {}, { notifier: { notify: vi.fn(async () => {}) } });
}

describe('AegisAgent.runCycle invocation wiring', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(MarketDataSource.getSnapshot).mockResolvedValue(marketData);
        llmMode.shouldCall = false;
        llmMode.canCall = false;
        llmMode.throws = false;
    });

    it('evaluateMarketConditions → hold → validateLLMDecision → normalizeReasoning', async () => {
        const agent = makeAgent();
        await agent.startSimulation(10000, { seed: 1, frequency: 'Low', dataMode: 'SIM' }, 'Invocation Test');
        await tick();
        await agent.stopSimulation();

        // Risk engine got the market snapshot + the simulation settings.
        expect(evaluateMarketConditions).toHaveBeenCalledTimes(1);
        expect(evaluateMarketConditions).toHaveBeenCalledWith(marketData, expect.objectContaining({ seed: 1, dataMode: 'SIM' }));

        // LLM skipped (shouldCallLLM false) → the hold shortcut, guard-railed.
        expect(shouldCallLLM).toHaveBeenCalled();
        expect(callLLM).not.toHaveBeenCalled();
        expect(validateLLMDecision).toHaveBeenCalledTimes(1);
        expect(normalizeReasoning).toHaveBeenCalledTimes(1);

        // The cycle persisted its snapshot to the DB.
        expect(insertPortfolioStats).toHaveBeenCalled();
    });

    it('LLM outage → deterministic fallback is invoked with the same inputs', async () => {
        llmMode.shouldCall = true;
        llmMode.canCall = true;
        llmMode.throws = true;
        const agent = makeAgent();
        await agent.startSimulation(10000, { seed: 3, frequency: 'Low', dataMode: 'SIM' }, 'Invocation Fallback');
        await tick();
        await agent.stopSimulation();

        expect(shouldCallLLM).toHaveBeenCalled();
        expect(callLLM).toHaveBeenCalled();
        expect(deterministicFallback).toHaveBeenCalledTimes(1);
        expect(deterministicFallback).toHaveBeenCalledWith(marketData, expect.any(Object), expect.any(Object));
    });

    it('agent refuses to run a cycle while not running', async () => {
        const agent = makeAgent();
        await agent.runCycle();
        expect(evaluateMarketConditions).not.toHaveBeenCalled();
    });

    it('runBacktest invokes the historical data service when no dataset given', async () => {
        vi.mocked(HistoricalDataService.buildBacktestDataset).mockResolvedValue(
            Array.from({ length: 30 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, susdeApy: 5, borrowApy: 4, fundingApy: 0 })),
        );
        await Backtester.runBacktest({ rangeDays: 30, leverage: 4 });
        expect(HistoricalDataService.buildBacktestDataset).toHaveBeenCalledWith(30);
    });

    it('persisted settings feed the decision path (getSettings read)', async () => {
        const agent = makeAgent();
        await agent.startSimulation(10000, { seed: 2, frequency: 'Low', dataMode: 'SIM' }, 'Invocation Thresholds');
        await tick();
        await agent.stopSimulation();
        // The agent reads the persisted settings during the decision phase.
        expect(getSettings).toHaveBeenCalled();
    });
});