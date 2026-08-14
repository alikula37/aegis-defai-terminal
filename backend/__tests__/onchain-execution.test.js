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
        },
        aave: {
            supply: vi.fn(async () => makeTx('aave.supply')),
            borrow: vi.fn(async () => makeTx('aave.borrow')),
            repay: vi.fn(async () => makeTx('aave.repay')),
        },
        ethena: {
            redeem: vi.fn(async () => makeTx('ethena.redeem')),
            deposit: vi.fn(async () => makeTx('ethena.deposit')),
        },
        pendle: {
            swapExactTokenForPt: vi.fn(async () => makeTx('pendle.swap')),
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
    const config = { gas: {}, slippageBps: 50, maxGasLimitUsd: 10 };
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
        const { exec, signer, broadcast } = makeExecution();
        await exec.execute({ decision: 'unwind' }, marketData, conditions);
        expect(signer.sendTransaction).toHaveBeenCalledTimes(2);
        expect(broadcast).toHaveBeenCalled();
        const infoMessages = broadcast.mock.calls.filter(([type]) => type === 'notification');
        expect(infoMessages.length).toBe(2);
        expect(infoMessages[0][1].message).toContain('Onchain morpho.repay submitted');
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
});
