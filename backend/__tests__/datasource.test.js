import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Mock the DB module so the facade's mode resolution is testable in isolation
vi.mock('../db/database.js', async (importOriginal) => {
    const mod = await importOriginal();
    return { ...mod, getSettings: vi.fn() };
});

import { setRngSeed } from '../utils/rng.js';
import { SimDataSource, resetSimulationPath } from '../core/data/SimDataSource.js';
import { MarketDataSource } from '../core/data/MarketDataSource.js';
import { getSettings } from '../db/database.js';

const state = {
    currentBorrowChain: 'Ethereum',
    currentBorrowProtocol: 'Morpho Blue',
    currentLtv: 0.8,
    currentCollateral: 'PT-sUSDe',
    allocations: { loop: 1.0, basis: 0.0, jit: 0.0 },
};

describe('SimDataSource', () => {
    beforeEach(() => setRngSeed(2026));

    // Portfolio rows are simulation-scoped (2a81ef5): the seed's snapshot
    // calls must carry the id resetPortfolio created for us.
    let seedSimId = null;

    beforeAll(async () => {
        // Per-worker temp DB is empty — seed a baseline portfolio so the
        // snapshot has a real starting TVL (matches the agent's lifecycle).
        const db = await import('../db/database.js');
        const seed = await db.resetPortfolio(10000, 'Datasource Seed', null, db.getLocalUserId());
        seedSimId = seed.simulationId;
    });

    it('produces the standard snapshot shape', async () => {
        resetSimulationPath(seedSimId);
        const s = await SimDataSource.getSnapshot(state, { scenario: 'stable', simulationId: seedSimId });
        expect(s.oracleStatus).toBe('SIM (stable)');
        expect(s.portfolio.tvl).toBeGreaterThan(0);
        expect(s.portfolio).toHaveProperty('healthFactor');
        expect(s.crossChain).toHaveProperty('bestCrossChainBorrowApy');
    });

    it('is deterministic for a fixed seed + reset path', async () => {
        resetSimulationPath(seedSimId);
        const a = await SimDataSource.getSnapshot(state, { scenario: 'stable', simulationId: seedSimId });
        resetSimulationPath(seedSimId);
        const b = await SimDataSource.getSnapshot(state, { scenario: 'stable', simulationId: seedSimId });
        expect(a).toEqual(b);
    });

    it('successive cycles evolve the path (stochastic, not static ranges)', async () => {
        resetSimulationPath(seedSimId);
        const first = await SimDataSource.getSnapshot(state, { scenario: 'stable', simulationId: seedSimId });
        const second = await SimDataSource.getSnapshot(state, { scenario: 'stable', simulationId: seedSimId });
        // Not identical to the previous cycle — the process advances.
        expect(second.susdeApy).not.toBe(first.susdeApy);
        expect(Number.isFinite(second.ethPrice)).toBe(true);
        // sUSDe peg stays near 1.00 in the stable scenario.
        expect(second.susdePrice).toBeGreaterThan(0.96);
        expect(second.susdePrice).toBeLessThan(1.04);
    });

    it('depeg scenario grinds sUSDe price downward over many cycles', async () => {
        resetSimulationPath(seedSimId);
        const first = await SimDataSource.getSnapshot(state, { scenario: 'depeg', simulationId: seedSimId });
        let price = first.susdePrice;
        for (let i = 0; i < 40; i++) {
            const s = await SimDataSource.getSnapshot(state, { scenario: 'depeg', simulationId: seedSimId });
            price = s.susdePrice;
        }
        // Persistent negative drift pulls the peg below its starting level.
        expect(price).toBeLessThan(first.susdePrice);
        expect(price).toBeLessThan(1.0);
    });

    it('bear scenario always has a negative spread', async () => {
        setRngSeed(1);
        resetSimulationPath(seedSimId);
        const s = await SimDataSource.getSnapshot(state, { scenario: 'bear', simulationId: seedSimId });
        expect(s.baseSpread).toBeLessThan(0);
        expect(s.leverage).toBe(1); // agent unwinds on negative spread
    });

    it('bull scenario has positive spread and leverage', async () => {
        setRngSeed(2);
        resetSimulationPath(seedSimId);
        const s = await SimDataSource.getSnapshot(state, { scenario: 'bull', simulationId: seedSimId });
        expect(s.baseSpread).toBeGreaterThan(0);
        expect(s.leverage).toBeGreaterThan(1);
    });
});

describe('MarketDataSource facade', () => {
    beforeEach(() => vi.mocked(getSettings).mockReset());

    it('defaults to LIVE mode', async () => {
        vi.mocked(getSettings).mockResolvedValue({ dataMode: 'LIVE', dataScenario: 'stable' });
        const { mode } = await MarketDataSource.resolveMode();
        expect(mode).toBe('LIVE');
    });

    it('resolves SIM mode with scenario from settings', async () => {
        vi.mocked(getSettings).mockResolvedValue({ dataMode: 'SIM', dataScenario: 'depeg' });
        const { mode, scenario } = await MarketDataSource.resolveMode();
        expect(mode).toBe('SIM');
        expect(scenario).toBe('depeg');
    });

    it('falls back to LIVE when settings read fails', async () => {
        vi.mocked(getSettings).mockRejectedValueOnce(new Error('db down'));
        const { mode } = await MarketDataSource.resolveMode();
        expect(mode).toBe('LIVE');
    });
});
