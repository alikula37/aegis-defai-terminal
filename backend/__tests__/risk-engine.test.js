import { describe, it, expect } from 'vitest';
import { evaluateMarketConditions } from '../core/RiskEngine.js';
import { estimateGasUsd, estimateMulticallGas, GAS_LIMITS, MULTICALL_SAVINGS_FACTOR } from '../execution/GasEstimator.js';

const marketData = {
    portfolio: { tvl: 10000, netApy: 15, healthFactor: 1.5 },
    baseSpread: 2,
    gasPrice: 15,
    ethPrice: 2500,
};

describe('evaluateMarketConditions', () => {
    it('marks safe when HF is above warning threshold', () => {
        const c = evaluateMarketConditions(marketData, { targetHf: 1.25 });
        expect(c.isSafe).toBe(true);
        expect(c.isWarning).toBe(false);
        expect(c.isCritical).toBe(false);
        expect(c.targetHf).toBe(1.25);
    });

    it('marks warning zone correctly', () => {
        const c = evaluateMarketConditions({ ...marketData, portfolio: { ...marketData.portfolio, healthFactor: 1.18 } }, { targetHf: 1.25 });
        expect(c.isSafe).toBe(false);
        expect(c.isWarning).toBe(true);
        expect(c.isCritical).toBe(false);
    });

    it('marks critical when HF is below critical threshold', () => {
        const c = evaluateMarketConditions({ ...marketData, portfolio: { ...marketData.portfolio, healthFactor: 1.05 } }, { targetHf: 1.25 });
        expect(c.isCritical).toBe(true);
    });

    it('marks critical on negative spread (yield inversion)', () => {
        const c = evaluateMarketConditions({ ...marketData, baseSpread: -1 }, { targetHf: 1.25 });
        expect(c.isCritical).toBe(true);
    });

    it('applies risk appetite fallbacks for older simulations', () => {
        const cons = evaluateMarketConditions(marketData, { riskAppetite: 'Conservative' });
        expect(cons.targetHf).toBe(1.40);
        expect(cons.criticalHf).toBe(1.25);
        const agg = evaluateMarketConditions(marketData, { riskAppetite: 'Aggressive' });
        expect(agg.targetHf).toBe(1.20);
        expect(agg.criticalHf).toBe(1.10);
    });

    it('computes claim profitability against gas threshold', () => {
        const cheap = evaluateMarketConditions(marketData, { maxGasClaim: 20 });
        expect(cheap.isClaimProfitable).toBe(true);
        const expensive = evaluateMarketConditions({ ...marketData, gasPrice: 40 }, { maxGasClaim: 20 });
        expect(expensive.isClaimProfitable).toBe(false);
    });
});

describe('estimateGasUsd', () => {
    it('matches the legacy formula (100k gas at 15 gwei * $2500)', () => {
        expect(estimateGasUsd({ gasPriceGwei: 15, ethPrice: 2500 })).toBeCloseTo((15 * 100000 * 1e-9) * 2500, 6);
    });

    it('honors a custom gas limit', () => {
        expect(estimateGasUsd({ gasPriceGwei: 15, ethPrice: 2500, gasLimit: GAS_LIMITS.flashLoan }))
            .toBeCloseTo((15 * GAS_LIMITS.flashLoan * 1e-9) * 2500, 6);
    });

    it('returns 0 for missing inputs', () => {
        expect(estimateGasUsd({})).toBe(0);
    });
});

describe('estimateMulticallGas', () => {
    it('applies the 0.52 savings factor to sequential cost', () => {
        const r = estimateMulticallGas({ gasCostUsd: 1, numCalls: 3 });
        expect(r.sequential).toBe(3);
        expect(r.batched).toBeCloseTo(3 * MULTICALL_SAVINGS_FACTOR, 6);
        expect(r.saved).toBeCloseTo(3 - 3 * MULTICALL_SAVINGS_FACTOR, 6);
    });
});
