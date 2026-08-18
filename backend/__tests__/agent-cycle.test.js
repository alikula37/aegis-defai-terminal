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

// Inline mock — importing the real module here would run dotenv.config() and
// leak backend/.env (EVM_PROVIDER_URL) into the test process, which flips
// onchain `providerConfigured` assertions.
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
import { callLLM, LLMUnavailableError } from '../services/LLMService.js';
import { insertPortfolioStats, insertMemory, getSettings } from '../db/database.js';
import { AegisAgent } from '../agent.js';
import aegisConfig from '../aegis.config.js';
import { evaluateMarketConditions } from '../core/RiskEngine.js';

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
    beforeEach(() => {
        vi.clearAllMocks();
        setRngSeed(2026);
    });

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

    // ---- Brain mode (free / no-credit UX) ----
    const CONDITIONS = {
        isCritical: false, isWarning: false,
        targetHf: 1.25, criticalHf: 1.15, warningHf: 1.21,
        isClaimProfitable: false, gasCostUsd: 1, estimatedClaimProfit: 0,
    };
    const CRITICAL = { ...CONDITIONS, isCritical: true };

    it('uses the local rule engine when brainMode is local — no LLM call, no error spam', async () => {
        callLLM.mockClear();
        const logs = [];
        const agent = makeAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        const settings = { brainMode: 'local', activeModel: 'x' };

        const decision = await agent._makeDecision(makeMarketData(), CONDITIONS, settings);

        expect(callLLM).not.toHaveBeenCalled();
        expect(decision.decision).toBe('hold');
        expect(logs.some(l => /OpenRouter API Error/.test(l.message || ''))).toBe(false);
    });

    it('falls back to the rule engine with a friendly info notice when OpenRouter returns 402', async () => {
        const err = new Error('Payment Required');
        err.status = 402;
        callLLM.mockRejectedValue(err);
        const logs = [];
        const agent = makeAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        const settings = { activeModel: 'x', openRouterKey: 'sk-test', llmToolsEnabled: false };

        const decision = await agent._makeDecision(makeMarketData(), CRITICAL, settings);

        expect(callLLM).toHaveBeenCalled();
        expect(decision.decision).toBe('flash_loan_rescue');
        const notice = logs.find(l => l.broadcastType === 'notification');
        expect(notice).toBeTruthy();
        expect(notice.type).toBe('info');
        expect(/credits/.test(notice.message)).toBe(true);
        expect(/OpenRouter API Error/.test(notice.message)).toBe(false);
    });

    it('broadcasts a friendly notice (not an error toast) when no API key is set', async () => {
        callLLM.mockRejectedValue(new LLMUnavailableError('OpenRouter API Key is missing or invalid.', { reason: 'no-key' }));
        const logs = [];
        const agent = makeAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        const settings = { activeModel: 'x', llmToolsEnabled: false };

        await agent._makeDecision(makeMarketData(), CRITICAL, settings);

        const notice = logs.find(l => l.broadcastType === 'notification');
        expect(notice).toBeTruthy();
        expect(notice.type).toBe('info');
        expect(/API key/.test(notice.message)).toBe(true);
        expect(/OpenRouter API Error/.test(notice.message)).toBe(false);
    });

    it('throttles repeated LLM failures to one notification per cooldown window', async () => {
        const err = new Error('Payment Required');
        err.status = 402;
        callLLM.mockRejectedValue(err);
        const logs = [];
        const agent = makeAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        const settings = { activeModel: 'x', openRouterKey: 'sk-test', llmToolsEnabled: false };

        await agent._makeDecision(makeMarketData(), CRITICAL, settings);
        await agent._makeDecision(makeMarketData(), CRITICAL, settings);

        const notices = logs.filter(l => l.broadcastType === 'notification');
        expect(notices).toHaveLength(1);
    });

    // ---- Settings coupling (start modal ↔ Settings page ↔ agent) ----

    it('risk assessment uses the persisted targetHf from settings', async () => {
        // The persisted settings are merged into the active simulation config
        // each cycle, so the risk zones the agent acts on match what the
        // Settings page / start modal show.
        getSettings.mockResolvedValue({
            openRouterKey: '', activeModel: 'test',
            targetHf: 1.40, maxGasClaim: 20, llmToolsEnabled: false, frequency: 'Medium',
        });
        callLLM.mockResolvedValue({ decision: 'hold', reasoning: 'ok', action: 'nothing' });
        const agent = makeAgent(() => {});
        agent.isRunning = true;
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData()); // HF 1.5

        await agent.runCycle();

        // Conservative (1.40) got merged over the default 1.25...
        expect(agent.simulationSettings.targetHf).toBe(1.40);
        // ...and the evaluated zones reflect it (critical 1.30, warning 1.36).
        const conditions = evaluateMarketConditions(makeMarketData(), agent.simulationSettings);
        expect(conditions.criticalHf).toBeCloseTo(1.30, 2);
        expect(conditions.warningHf).toBeCloseTo(1.36, 2);
    });

    it('applies the persisted cycle frequency from settings', async () => {
        getSettings.mockResolvedValue({
            openRouterKey: '', activeModel: 'test',
            targetHf: 1.25, maxGasClaim: 20, llmToolsEnabled: false, frequency: 'High',
        });
        const agent = makeAgent(() => {});
        agent.isRunning = true;
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData());

        await agent.runCycle();

        expect(agent.cycleIntervalMs).toBe(15000);
    });

    it('auto-stops when the chosen duration is reached', async () => {
        const logs = [];
        const agent = makeAgent((type, payload) => logs.push({ broadcastType: type, ...payload }));
        agent.isRunning = true;
        agent.stopAfter = Date.now() - 1000; // expired

        await agent.runCycle();

        expect(logs.some(l => /auto-stopping/.test(l.message))).toBe(true);
        expect(agent.isRunning).toBe(false);
        expect(insertPortfolioStats).not.toHaveBeenCalled();
    });
});
