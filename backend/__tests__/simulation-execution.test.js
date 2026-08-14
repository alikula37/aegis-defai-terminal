import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SimulationExecution } from '../execution/SimulationExecution.js';
import { setRngSeed } from '../utils/rng.js';

function makeCtx(overrides = {}) {
    const ctx = {
        state: { currentBorrowChain: 'Ethereum', currentBorrowProtocol: 'Morpho Blue', currentLtv: 0.8, currentCollateral: 'PT-sUSDe', allocations: { loop: 1, basis: 0, jit: 0 } },
        settings: () => ({ targetHf: 1.25, maxGasClaim: 20 }),
        cooldowns: {},
        broadcast: vi.fn(),
        log: vi.fn(),
        insertMemory: vi.fn(),
        insertPortfolioStats: vi.fn(() => ({ tvl: 0, netApy: 0, healthFactor: 0 })),
        ...overrides,
    };
    return ctx;
}

const marketData = {
    portfolio: { tvl: 10000, netApy: 15, healthFactor: 1.5, strategies: [] },
    gasPrice: 15,
    ethPrice: 2500,
    leverage: 5,
    bestBorrowApy: 6,
    morphoBorrowApy: 6,
    aaveV4BorrowApy: 3,
    crossChain: { crossChainNetwork: 'Base', bestCrossChainBorrowApy: 4, crossChainSavings: 2, bridgeCostUsd: 25 },
};
const conditions = { hourlyYield: 0.17, gasCostUsd: 0.0375 };

describe('SimulationExecution', () => {
    beforeEach(() => {
        setRngSeed(42);
    });

    it('treats hold as a no-op scan', async () => {
        const ctx = makeCtx();
        const exec = new SimulationExecution(ctx);
        await exec.execute({ decision: 'hold', action: 'No action', reasoning: 'ok' }, marketData, conditions);
        expect(ctx.log).toHaveBeenCalledWith('scan', '🔍 No action');
        expect(ctx.insertMemory).not.toHaveBeenCalled();
    });

    it('records cooldown for actionable decisions', async () => {
        const ctx = makeCtx();
        const exec = new SimulationExecution(ctx);
        await exec.execute({ decision: 'claim', action: 'claim', reasoning: 'ok' }, marketData, conditions);
        expect(ctx.cooldowns.claim).toBeTruthy();
    });

    it('warns about high MEV risk and routes via private mempool', async () => {
        const ctx = makeCtx();
        const exec = new SimulationExecution(ctx);
        await exec.execute({ decision: 'unwind', action: 'unwind', reasoning: 'r' }, { ...marketData, gasPrice: 80, portfolio: { ...marketData.portfolio, tvl: 1000000 } }, conditions);
        expect(ctx.log.mock.calls.some(([t, m]) => t === 'system' && /private bundle/.test(m))).toBe(true);
    });

    it('narrates multicall batching for multi-step actions', async () => {
        const ctx = makeCtx();
        const exec = new SimulationExecution(ctx);
        await exec.execute({ decision: 'adjust_portfolio', target_ltv: 0.7, reasoning: 'r' }, marketData, conditions);
        expect(ctx.log.mock.calls.some(([, m]) => /Multicall3/.test(m))).toBe(true);
    });

    it('adjust_portfolio mutates LTV and persists stats with a numeric simulationId', async () => {
        const ctx = makeCtx();
        ctx.activeSimulationId = 7;
        const exec = new SimulationExecution(ctx);
        await exec.execute({ decision: 'adjust_portfolio', target_ltv: 0.7, reasoning: 'r' }, marketData, conditions);
        expect(ctx.state.currentLtv).toBeCloseTo(0.7, 10);
        expect(ctx.insertMemory).toHaveBeenCalled();
        // insertPortfolioStats runs inside setTimeout — advance timers
        await new Promise(r => setTimeout(r, 3100));
        const call = ctx.insertPortfolioStats.mock.calls[0];
        expect(call.at(-1)).toBe(7);
    });

    it('flash_loan_rescue resets LTV and restores health factor', async () => {
        const ctx = makeCtx();
        const exec = new SimulationExecution(ctx);
        await exec.execute({ decision: 'flash_loan_rescue', reasoning: 'critical' }, marketData, conditions);
        expect(ctx.state.currentLtv).toBe(0);
        expect(ctx.log.mock.calls.some(([t]) => t === 'flash_loan')).toBe(true);
        await new Promise(r => setTimeout(r, 3100));
        expect(ctx.broadcast).toHaveBeenCalled();
    });

    it('claim deducts gas cost from TVL', async () => {
        const ctx = makeCtx();
        const exec = new SimulationExecution(ctx);
        const before = marketData.portfolio.tvl;
        await exec.execute({ decision: 'claim', action: 'claiming', reasoning: 'profit' }, marketData, conditions);
        expect(marketData.portfolio.tvl).toBeLessThan(before);
        expect(ctx.insertMemory).toHaveBeenCalledWith(marketData, 'claim', true, expect.any(Number), undefined);
    });

    it('unwind sets LTV to 0', async () => {
        const ctx = makeCtx();
        const exec = new SimulationExecution(ctx);
        await exec.execute({ decision: 'unwind', action: 'unwinding', reasoning: 'neg spread' }, marketData, conditions);
        expect(ctx.state.currentLtv).toBe(0);
    });

    it('migrate_borrow switches protocol to Aave', async () => {
        const ctx = makeCtx();
        const exec = new SimulationExecution(ctx);
        await exec.execute({ decision: 'migrate_borrow', action: 'migrate', reasoning: 'cheaper' }, marketData, conditions);
        expect(ctx.state.currentBorrowProtocol).toBe('Aave V4 E-Mode');
    });

    it('reallocate_capital validates allocation sum', async () => {
        const ctx = makeCtx();
        const exec = new SimulationExecution(ctx);
        await exec.execute({ decision: 'reallocate_capital', target_allocations: { loop: 0.6, basis: 0.2, jit: 0.2 }, reasoning: 'optimize' }, marketData, conditions);
        expect(ctx.state.allocations).toEqual({ loop: 0.6, basis: 0.2, jit: 0.2 });

        const ctx2 = makeCtx();
        const exec2 = new SimulationExecution(ctx2);
        await exec2.execute({ decision: 'reallocate_capital', target_allocations: { loop: 0.5, basis: 0.2, jit: 0.1 }, reasoning: 'bad' }, marketData, conditions);
        expect(ctx2.state.allocations.loop).toBe(1); // unchanged
        expect(ctx2.log.mock.calls.some(([, m]) => /Invalid target allocations/.test(m))).toBe(true);
    });

    it('cross_chain_migrate updates borrow chain and applies bridge cost', async () => {
        const ctx = makeCtx();
        const exec = new SimulationExecution(ctx);
        await exec.execute({ decision: 'cross_chain_migrate', reasoning: 'arb' }, marketData, conditions);
        expect(ctx.state.currentBorrowChain).toBe('Base');
        expect(ctx.insertMemory).toHaveBeenCalledWith(marketData, 'cross_chain_migrate', false, expect.any(Number), undefined);
    });

    it('adjust_portfolio switches collateral when requested', async () => {
        const ctx = makeCtx();
        const exec = new SimulationExecution(ctx);
        await exec.execute({ decision: 'adjust_portfolio', target_collateral: 'sUSDe', reasoning: 'switch' }, marketData, conditions);
        expect(ctx.state.currentCollateral).toBe('sUSDe');
        expect(ctx.log.mock.calls.some(([, m]) => /Switching collateral/.test(m))).toBe(true);
    });

    it('adjust_portfolio skips both switches when targets match current state', async () => {
        const ctx = makeCtx();
        const exec = new SimulationExecution(ctx);
        await exec.execute({ decision: 'adjust_portfolio', target_collateral: 'PT-sUSDe', target_ltv: 0.8, reasoning: 'noop' }, marketData, conditions);
        expect(ctx.state.currentLtv).toBe(0.8);
        expect(ctx.log.mock.calls.some(([, m]) => /Switching collateral/.test(m))).toBe(false);
        expect(ctx.log.mock.calls.some(([, m]) => /Adjusting LTV/.test(m))).toBe(false);
    });

    it('cross_chain_migrate logs an alert when bridge costs exceed savings', async () => {
        const ctx = makeCtx();
        const exec = new SimulationExecution(ctx);
        const bad = {
            ...marketData,
            crossChain: { ...marketData.crossChain, bridgeCostUsd: 9999, bestCrossChainBorrowApy: 5.99, crossChainSavings: 0.01 },
        };
        await exec.execute({ decision: 'cross_chain_migrate', reasoning: 'arb' }, bad, conditions);
        expect(ctx.log.mock.calls.some(([t, m]) => t === 'alert' && /Bridge costs exceeded/.test(m))).toBe(true);
        expect(ctx.state.currentBorrowChain).toBe('Base');
    });
});
