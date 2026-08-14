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
import { insertMemory } from '../db/database.js';
import { AegisAgent } from '../agent.js';

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
        // live sUSDe position so the claim plan resolves a real redeem amount
        positions: { sUSDe: { shares: 1000000 } },
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

const mockProvider = {
    getFeeData: async () => ({ gasPrice: 20000000000n }),
    estimateGas: async () => 21000n,
};

const mockSigner = {
    getAddress: async () => '0x9767de120c29ca81Be56be02fC662b0513282435',
    sendTransaction: async () => ({ hash: '0xdeadbeef' }),
};

// Only the Ethena connector is "deployed" — it covers the claim path without
// touching Morpho/Aave/Pendle (mirrors Sepolia where those are absent).
const mockConnectors = {
    morpho: null,
    aave: null,
    ethena: {
        redeem: async () => ({ to: '0x9D39A5DE30e57443BfF2A8307A4256c8797A3497', data: '0xabcdef', value: 0n }),
    },
    pendle: null,
};

describe('AegisAgent onchain execution mode', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setRngSeed(2026);
        delete process.env.EXECUTION_MODE;
    });

    it('exposes execution status for the default (simulation) mode as ready', () => {
        const agent = new AegisAgent(() => { });
        const status = agent.getExecutionStatus();
        expect(status.mode).toBe('simulation');
        expect(status.ready).toBe(true);
    });

    it('exposes onchain status as NOT ready when no wallet is configured', () => {
        const agent = new AegisAgent(() => { }, {
            executionMode: 'onchain',
            onchain: { rpcUrl: null, chainId: 11155111 },
        });
        const status = agent.getExecutionStatus();
        expect(status.mode).toBe('onchain');
        expect(status.chainId).toBe(11155111);
        expect(status.providerConfigured).toBe(false);
        expect(status.signerConfigured).toBe(false);
        expect(status.ready).toBe(false);
    });

    it('refuses to execute in onchain mode without a wallet (read-only cycle, no crash)', async () => {
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData({ baseSpread: -2 }));
        callLLM.mockRejectedValue(new Error('OpenRouter API Error: timeout'));
        const logs = [];
        const agent = new AegisAgent((type, payload) => logs.push({ broadcastType: type, ...payload }), {
            executionMode: 'onchain',
            onchain: { rpcUrl: null, chainId: 11155111 },
        });
        agent.isRunning = true;

        await agent.runCycle();

        // the not-ready warning was broadcast once
        expect(logs.filter(l => /Execution not ready/.test(l.message)).length).toBe(1);
        // the deterministic rescue decision was NOT executed on-chain
        expect(insertMemory).not.toHaveBeenCalled();
        expect(logs.some(l => l.type === 'flash_loan')).toBe(false);
        expect(agent.isRunning).toBe(true);
    });

    it('routes decisions through the onchain backend end-to-end when deps are configured', async () => {
        MarketDataSource.getSnapshot.mockResolvedValue(makeMarketData());
        callLLM.mockResolvedValue({ decision: 'claim', reasoning: 'profit', action: 'Claiming rewards' });
        const logs = [];
        const agent = new AegisAgent((type, payload) => logs.push({ broadcastType: type, ...payload }), {
            executionMode: 'onchain',
            onchain: {
                chainId: 11155111,
                deps: { provider: mockProvider, signer: mockSigner, address: '0x9767de120c29ca81Be56be02fC662b0513282435' },
                connectors: mockConnectors,
            },
        });
        agent.isRunning = true;

        const status = agent.getExecutionStatus();
        expect(status.ready).toBe(true);
        expect(status.signerAddress).toBe('0x9767de120c29ca81Be56be02fC662b0513282435');

        await agent.runCycle();

        // plan was built → MEV check ran → tx was "broadcast" → notification sent
        expect(logs.some(l => l.broadcastType === 'notification' && /Onchain ethena.redeem submitted: 0xdeadbeef/.test(l.message))).toBe(true);
        // gas guard ran (cost was estimated, not aborted)
        expect(logs.some(l => /Estimated gas cost/.test(l.message))).toBe(true);
        // memory entry recorded the executed onchain action
        expect(insertMemory).toHaveBeenCalledWith(expect.anything(), 'claim', true, expect.any(Number), null, expect.any(Object));
    });

    it('falls back to simulation mode for an invalid EXECUTION_MODE value', () => {
        process.env.EXECUTION_MODE = 'quantum';
        const agent = new AegisAgent(() => { });
        expect(agent.getExecutionStatus().mode).toBe('simulation');
        expect(agent.getExecutionStatus().ready).toBe(true);
    });
});
