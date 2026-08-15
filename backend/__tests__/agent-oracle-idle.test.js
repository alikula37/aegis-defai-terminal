// Regression guard for the "values resurrect after delete" bug:
// the always-on oracle ticker must NEVER broadcast portfolio data while no
// simulation is active — getLatestPortfolio(null) used to read the global
// latest row and the frontend's hasData flag resurrected stale/deleted
// values on the dashboard every 60s.
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

import { MarketDataSource } from '../core/data/MarketDataSource.js';
import { AegisAgent } from '../agent.js';

describe('AegisAgent oracle ticker (idle safety)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        MarketDataSource.getSnapshot.mockResolvedValue({
            portfolio: { tvl: 5000, netApy: 10 },
            oracleStatus: 'LIVE',
            ethPrice: 3000,
            usdcPrice: 1,
            susdeApy: 12,
            pendlePtSusdeApy: 14,
            morphoBorrowApy: 6,
            aaveV4BorrowApy: 6.5,
            bestBorrowApy: 6,
            baseSpread: 6,
            leverage: 3,
            netApy: 10,
            gasPrice: 5,
            blockNumber: 123,
            points: {},
            crossChain: {},
        });
    });

    it('does not broadcast portfolio_update when no simulation is active', async () => {
        const broadcasts = [];
        const agent = new AegisAgent((type, payload) => broadcasts.push({ type, ...payload }));
        agent.activeSimulationId = null; // idle — everything deleted/stopped

        await agent._broadcastOracle();

        expect(MarketDataSource.getSnapshot).not.toHaveBeenCalled();
        expect(broadcasts).toEqual([]);
    });

    it('broadcasts the oracle payload when a simulation IS active', async () => {
        const broadcasts = [];
        const agent = new AegisAgent((type, payload) => broadcasts.push({ type, ...payload }));
        agent.activeSimulationId = 42;

        await agent._broadcastOracle();

        expect(broadcasts.filter(b => b.type === 'portfolio_update')).toHaveLength(1);
        expect(broadcasts[0]).toHaveProperty('tvl');
    });
});
