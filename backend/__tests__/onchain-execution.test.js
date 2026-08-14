import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OnchainExecution, assertSlippage } from '../execution/OnchainExecution.js';

const makeTx = name => ({ to: '0x0000000000000000000000000000000000000001', data: '0x00', name });

function buildMockDeps() {
    const connectors = {
        morpho: {
            borrow: vi.fn(async () => makeTx('morpho.borrow')),
            repay: vi.fn(async () => makeTx('morpho.repay')),
            withdraw: vi.fn(async () => makeTx('morpho.withdraw')),
            flashLoan: vi.fn(async () => makeTx('morpho.flashLoan')),
            approve: vi.fn(async () => makeTx('morpho.approve')),
        },
        aave: {
            supply: vi.fn(async () => makeTx('aave.supply')),
            borrow: vi.fn(async () => makeTx('aave.borrow')),
            repay: vi.fn(async () => makeTx('aave.repay')),
            approve: vi.fn(async () => makeTx('aave.approve')),
        },
        ethena: {
            redeem: vi.fn(async () => makeTx('ethena.redeem')),
            deposit: vi.fn(async () => makeTx('ethena.deposit')),
        },
        pendle: {
            swapExactTokenForPt: vi.fn(async () => makeTx('pendle.swap')),
            approveToken: vi.fn(async () => makeTx('pendle.approve')),
        },
    };
    const provider = {
        estimateGas: vi.fn(async () => 100000n),
        getFeeData: vi.fn(async () => ({ gasPrice: 15n * 10n ** 9n })),
    };
    const signer = {
        getAddress: vi.fn(async () => '0x1234567890123456789012345678901234567890'),
        sendTransaction: vi.fn(async () => ({ hash: '0x' + 'a'.repeat(64) })),
    };
    const log = vi.fn();
    const broadcast = vi.fn();
    return { connectors, provider, signer, log, broadcast };
}

const marketData = {
    portfolio: { tvl: 10000, currentLtv: 0.8, healthFactor: 1.5 },
    gasPrice: 15,
    ethPrice: 2500,
    leverage: 5,
    // Pendle PT collateral used by Morpho plans (resolved by _ptToken)
    strategies: [{ id: 'pendle-pt-susde', name: 'Pendle PT-sUSDe', tokenAddress: '0x000000000000000000000000000000000000dEaD' }],
};
const conditions = {};

function makeExecution(overrides = {}) {
    const deps = buildMockDeps();
    const config = {
        gas: {},
        slippageBps: 50,
        maxGasLimitUsd: 100,
        // A2 — Morpho plans require the full market triple (fail-closed without it)
        morphoMarket: { collateralToken: '0x000000000000000000000000000000000000dEaD', oracle: '0x1', irm: '0x2', lltv: 860000n },
    };
    const exec = new OnchainExecution({
        provider: deps.provider,
        signer: deps.signer,
        chainId: 1,
        connectors: deps.connectors,
        config,
        log: deps.log,
        broadcast: deps.broadcast,
        ...overrides,
    });
    return { exec, ...deps, config };
}

beforeEach(() => {
    // Mainnet chainId 1: allow broadcast for these logic tests (the mock signer
    // never touches real funds). A dedicated test asserts the default lockdown.
    process.env.ALLOW_MAINNET_LIVE = 'true';
});

describe('assertSlippage', () => {
    it('passes within limit', () => {
        expect(assertSlippage(100, 99, 100)).toBe(true);  // 1% slippage, 100bps limit
    });
    it('fails beyond limit', () => {
        expect(assertSlippage(100, 98, 100)).toBe(false);
    });
    it('fails on non-numeric input', () => {
        expect(assertSlippage(NaN, 10, 100)).toBe(false);
    });

    // ---- Data-detailed: slippage matrix (expected 100, bps 0..100) ----
    it.each([
        // [expected, actual, bps, result]
        [100, 100, 0, true],     // no slippage allowed, exact match
        [100, 99.999, 0, false], // below 100 even by a hair
        [100, 99.5, 50, true],   // 0.5% tolerance, 0.5% slip → edge pass
        [100, 99.49, 50, false], // 0.5% tolerance, just over → fail
        [100, 95, 50, false],    // 5% slip way over 0.5%
        [100, 99, 100, true],    // 1% tolerance, 1% slip → edge pass
        [100, 98.99, 100, false],
        [100, 90, 100, false],
        [100, 101, 100, true],   // overshooting the expected is allowed
        [1000, 999, 100, true],
        [1000, 990, 100, true],  // exactly at the 1% tolerance edge
        [1000, 989, 100, false], // just past the edge
        [1000, 900, 10, false],
        [0, 0, 50, true],        // zero expected: anything matches? assertSlippage allows
        [100, Infinity, 50, false],
        [100, -Infinity, 50, false],
        [100, -5, 50, false],
    ])('expected=%s actual=%s bps=%s → %s', (expected, actual, bps, result) => {
        expect(assertSlippage(expected, actual, bps)).toBe(result);
    });
});

describe('OnchainExecution', () => {
    beforeEach(() => vi.clearAllMocks());

    it('refuses to run without a signer/provider', async () => {
        const exec = new OnchainExecution({ log: () => { }, config: {} });
        await expect(exec.execute({ decision: 'claim' }, marketData, conditions))
            .rejects.toThrow(/not configured/i);
    });

    it('BLOCKS mainnet broadcasts unless ALLOW_MAINNET_LIVE=true (lockdown)', async () => {
        delete process.env.ALLOW_MAINNET_LIVE;
        const { exec, connectors, signer } = makeExecution();
        await exec.execute({ decision: 'unwind' }, marketData, conditions);
        expect(signer.sendTransaction).not.toHaveBeenCalled();
        expect(connectors.morpho.repay).not.toHaveBeenCalled();
        expect(exec.log.mock.calls.some(([, m]) => /BLOCKED/.test(m))).toBe(true);
    });

    it('refuses a claim without a resolvable sUSDe position', async () => {
        const { exec, connectors, signer } = makeExecution();
        await exec.execute({ decision: 'claim' }, marketData, conditions);
        expect(connectors.ethena.redeem).not.toHaveBeenCalled();
        expect(signer.sendTransaction).not.toHaveBeenCalled();
        expect(exec.log.mock.calls.some(([, m]) => /not resolvable/.test(m))).toBe(true);
    });

    it('refuses Morpho plans when the PT collateral cannot be resolved', async () => {
        const { exec, connectors, signer } = makeExecution();
        await exec.execute(
            { decision: 'unwind' },
            { ...marketData, strategies: [] },
            conditions,
        );
        expect(connectors.morpho.repay).not.toHaveBeenCalled();
        expect(signer.sendTransaction).not.toHaveBeenCalled();
        expect(exec.log.mock.calls.some(([, m]) => /not resolvable/.test(m))).toBe(true);
    });

    it('builds a repay plan when lowering LTV', async () => {
        const { exec, connectors } = makeExecution();
        await exec.execute({ decision: 'adjust_portfolio', target_ltv: 0.7 }, marketData, conditions);
        expect(connectors.morpho.repay).toHaveBeenCalledTimes(1);
        expect(connectors.morpho.borrow).not.toHaveBeenCalled();
    });

    it('builds a borrow plan when raising LTV', async () => {
        const { exec, connectors } = makeExecution();
        await exec.execute({ decision: 'adjust_portfolio', target_ltv: 0.9 }, marketData, conditions);
        expect(connectors.morpho.borrow).toHaveBeenCalledTimes(1);
    });

    it('submits a flash loan for rescue', async () => {
        const { exec, connectors, signer } = makeExecution();
        await exec.execute({ decision: 'flash_loan_rescue' }, marketData, conditions);
        expect(connectors.morpho.flashLoan).toHaveBeenCalledTimes(1);
        expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it('aborts when estimated gas exceeds the USD limit', async () => {
        const { exec, signer, broadcast, config } = makeExecution();
        config.maxGasLimitUsd = 0.001; // estimated cost ~$3.75 > $0.001
        await exec.execute({ decision: 'unwind' }, marketData, conditions);
        expect(signer.sendTransaction).not.toHaveBeenCalled();
        expect(broadcast).not.toHaveBeenCalled();
        expect(exec.log.mock.calls.some(([, m]) => /Gas Guard/.test(m))).toBe(true);
    });

    it('sends each tx and broadcasts hashes on success', async () => {
        const { exec, connectors, signer, broadcast } = makeExecution();
        // sync reports an open Morpho debt → unwind = approve + repay + withdraw
        connectors.morpho.getPosition = vi.fn(async () => ({
            supplyShares: 0n, borrowShares: 500n, collateral: 12n, marketId: '0x' + 'c'.repeat(64),
        }));
        await exec.execute({ decision: 'unwind' }, marketData, conditions);
        expect(signer.sendTransaction).toHaveBeenCalledTimes(3);
        expect(broadcast).toHaveBeenCalled();
        const infoMessages = broadcast.mock.calls.filter(([type]) => type === 'notification');
        expect(infoMessages.length).toBe(3);
        expect(infoMessages[0][1].message).toContain('Onchain morpho.approve-usdc submitted');
    });

    it('skips the repay leg when live positions show zero Morpho debt (A2)', async () => {
        const { exec, connectors, signer } = makeExecution();
        // sync resolves a real zero-debt position (market configured)
        connectors.morpho.getPosition = vi.fn(async () => ({
            supplyShares: 0n, borrowShares: 0n, collateral: 12n, marketId: '0x' + 'b'.repeat(64),
        }));
        const md = { ...marketData, strategies: [] };
        await exec.execute({ decision: 'unwind' }, md, conditions);
        expect(connectors.morpho.repay).not.toHaveBeenCalled();
        expect(connectors.morpho.approve).not.toHaveBeenCalled();
        // only the withdraw step
        expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
    });

    it('refuses Morpho plans when the market triple is not configured (A2)', async () => {
        const { exec, connectors, signer } = makeExecution();
        exec.config.morphoMarket = undefined;
        await exec.execute({ decision: 'unwind' }, marketData, conditions);
        expect(connectors.morpho.repay).not.toHaveBeenCalled();
        expect(signer.sendTransaction).not.toHaveBeenCalled();
        expect(exec.log.mock.calls.some(([, m]) => /morphoMarket/.test(m))).toBe(true);
    });

    it('refuses the unwind repay when the debt position is unknown (A2 fail-closed)', async () => {
        const { exec, connectors, signer } = makeExecution();
        // no getPosition mock → sync yields no morpho position → debt unknown
        await exec.execute({ decision: 'unwind' }, marketData, conditions);
        expect(connectors.morpho.repay).not.toHaveBeenCalled();
        expect(connectors.morpho.approve).not.toHaveBeenCalled();
        // only the withdraw step is sent
        expect(signer.sendTransaction).toHaveBeenCalledTimes(1);
        expect(exec.log.mock.calls.some(([, m]) => /debt position unavailable/.test(m))).toBe(true);
    });

    it('includes approval steps for borrow/repay/migrate/reallocate plans (A2)', async () => {
        const { exec, connectors } = makeExecution();
        await exec.execute({ decision: 'adjust_portfolio', target_ltv: 0.9 }, marketData, conditions); // borrow
        expect(connectors.morpho.approve).toHaveBeenCalledTimes(1);
        await exec.execute({ decision: 'adjust_portfolio', target_ltv: 0.7 }, marketData, conditions); // repay
        expect(connectors.morpho.approve).toHaveBeenCalledTimes(2);

        const md = { ...marketData, positions: { sUSDe: { shares: 1000000 } } };
        await exec.execute({ decision: 'reallocate_capital', target_allocations: { loop: 0.5, basis: 0.5, jit: 0 } }, md, conditions);
        expect(connectors.pendle.approveToken).toHaveBeenCalledTimes(1);
    });

    it('routes high-risk execution via private mempool messaging', async () => {
        const { exec } = makeExecution();
        await exec.execute({ decision: 'unwind' }, { ...marketData, gasPrice: 80, portfolio: { ...marketData.portfolio, tvl: 1000000 } }, conditions);
        expect(exec.log.mock.calls.some(([, m]) => /private mempool/.test(m))).toBe(true);
    });

    it('treats unknown decisions as a no-op scan', async () => {
        const { exec, signer, connectors } = makeExecution();
        await exec.execute({ decision: 'hold' }, marketData, conditions);
        expect(signer.sendTransaction).not.toHaveBeenCalled();
        expect(connectors.morpho.repay).not.toHaveBeenCalled();
    });

    it('defaults unavailable protocol connectors to null and refuses their plans', async () => {
        // Arbitrum (42161) has no Morpho Blue in protocolConfig → connector is null
        const deps = buildMockDeps();
        const logs = [];
        const exec = new OnchainExecution({
            provider: deps.provider,
            signer: deps.signer,
            chainId: 42161,
            log: (t, m) => logs.push(m),
            broadcast: () => { },
            config: { maxGasLimitUsd: 10, slippageBps: 50 },
        });
        expect(exec.connectors.morpho).toBeNull();
        await exec.execute({ decision: 'unwind' }, marketData, conditions);
        expect(deps.signer.sendTransaction).not.toHaveBeenCalled();
        expect(logs.some(m => /not available/.test(m))).toBe(true);
    });

    // ---- A1: live position sync ----

    it('syncs live positions and uses them to resolve plan collateral/amounts (A1)', async () => {
        const deps = buildMockDeps();
        // connectors expose the new read methods
        deps.connectors.morpho.getPosition = vi.fn(async () => ({
            supplyShares: 5n, borrowShares: 900n, collateral: 12n, marketId: '0x' + 'a'.repeat(64),
        }));
        deps.connectors.ethena.getBalance = vi.fn(async () => 2500000n);
        deps.connectors.aave.getATokenBalance = vi.fn(async () => 0n);
        deps.connectors.aave.getVariableDebt = vi.fn(async () => 0n);

        const exec = new OnchainExecution({
            provider: deps.provider,
            signer: deps.signer,
            chainId: 1,
            connectors: deps.connectors,
            config: {
                maxGasLimitUsd: 100, slippageBps: 50,
                morphoMarket: { collateralToken: '0x000000000000000000000000000000000000dEaD', oracle: '0x1', irm: '0x2', lltv: 860000n },
            },
            log: deps.log,
            broadcast: deps.broadcast,
        });

        const md = { portfolio: { tvl: 10000 }, gasPrice: 15, ethPrice: 2500, leverage: 5 };
        await exec._syncLivePositions(md);

        expect(md.livePositions.morpho.borrowShares).toBe(900n);
        expect(md.livePositions.morpho.collateralToken).toBe('0x000000000000000000000000000000000000dEaD');
        expect(md.livePositions.sUSDe.shares).toBe(2500000n);
        expect(md.livePositions.aave.usdcAToken).toBe(0n);

        // _ptToken prefers the live Morpho collateral; _sharesForTvl the live sUSDe
        expect(exec._ptToken(md)).toBe('0x000000000000000000000000000000000000dEaD');
        expect(exec._sharesForTvl(md)).toBe(2500000n);
    });

    it('skips position legs that are not configured or fail (A1)', async () => {
        const deps = buildMockDeps();
        deps.connectors.ethena.getBalance = vi.fn(async () => { throw new Error('rpc down'); });
        const exec = new OnchainExecution({
            provider: deps.provider,
            signer: deps.signer,
            chainId: 1,
            connectors: deps.connectors,
            config: { maxGasLimitUsd: 100, slippageBps: 50 }, // no morphoMarket → morpho leg skipped
            log: deps.log,
            broadcast: deps.broadcast,
        });
        const md = { portfolio: { tvl: 10000 }, gasPrice: 15, ethPrice: 2500, leverage: 5 };
        await exec._syncLivePositions(md); // must not throw
        expect(md.livePositions).toEqual({}); // all legs skipped gracefully
        expect(exec._ptToken(md)).toBeNull();
        expect(exec._sharesForTvl(md)).toBeNull();
    });

    it('resolves PT/shares from legacy snapshot positions when no live sync ran (A1)', () => {
        const { exec } = makeExecution();
        const md = { positions: { sUSDe: { shares: 1000000 } } };
        expect(exec._sharesForTvl(md)).toBe(1000000n);
    });
});
