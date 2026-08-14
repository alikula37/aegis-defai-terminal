import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Mock the DB module so the facade's mode resolution is testable in isolation
vi.mock('../db/database.js', async (importOriginal) => {
    const mod = await importOriginal();
    return { ...mod, getSettings: vi.fn() };
});

import { setRngSeed } from '../utils/rng.js';
import { SimDataSource } from '../core/data/SimDataSource.js';
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

    beforeAll(async () => {
        // Per-worker temp DB is empty — seed a baseline portfolio so the
        // snapshot has a real starting TVL (matches the agent's lifecycle).
        const db = await import('../db/database.js');
        await db.resetPortfolio(10000, 'Datasource Seed', null, db.getLocalUserId());
    });

    it('produces the standard snapshot shape', async () => {
        const s = await SimDataSource.getSnapshot(state, { scenario: 'stable' });
        expect(s.oracleStatus).toBe('SIM (stable)');
        expect(s.portfolio.tvl).toBeGreaterThan(0);
        expect(s.portfolio).toHaveProperty('healthFactor');
        expect(s.crossChain).toHaveProperty('bestCrossChainBorrowApy');
    });

    it('is deterministic for a fixed seed', async () => {
        const a = await SimDataSource.getSnapshot(state, { scenario: 'stable' });
        setRngSeed(2026);
        const b = await SimDataSource.getSnapshot(state, { scenario: 'stable' });
        expect(a).toEqual(b);
    });

    it('bear scenario always has a negative spread', async () => {
        setRngSeed(1);
        const s = await SimDataSource.getSnapshot(state, { scenario: 'bear' });
        expect(s.baseSpread).toBeLessThan(0);
        expect(s.leverage).toBe(1); // agent unwinds on negative spread
    });

    it('bull scenario has positive spread and leverage', async () => {
        setRngSeed(2);
        const s = await SimDataSource.getSnapshot(state, { scenario: 'bull' });
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
