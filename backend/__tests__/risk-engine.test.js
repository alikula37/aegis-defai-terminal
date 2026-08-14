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

// ---- Data-detailed: health-factor classification matrix ----
// targetHf 1.25 → warning 1.21, critical 1.15. Every 0.01 step from 1.00 to
// 1.50 is pinned to exactly one zone so threshold edges are locked down.
const HF_MATRIX = [];
for (let hundredths = 100; hundredths <= 150; hundredths += 1) {
    const hf = hundredths / 100;
    const expected = hf >= 1.21 ? 'safe' : hf >= 1.15 ? 'warning' : 'critical';
    HF_MATRIX.push([hf, expected]);
}

describe('evaluateMarketConditions — HF classification matrix (51 points)', () => {
    it.each(HF_MATRIX)('HF %s → %s', (hf, expectedZone) => {
        const c = evaluateMarketConditions({ ...marketData, portfolio: { ...marketData.portfolio, healthFactor: hf } }, { targetHf: 1.25 });
        expect(c.isSafe).toBe(expectedZone === 'safe');
        expect(c.isWarning).toBe(expectedZone === 'warning');
        expect(c.isCritical).toBe(expectedZone === 'critical');
        // zone exclusivity: exactly one flag is true
        expect([c.isSafe, c.isWarning, c.isCritical].filter(Boolean)).toHaveLength(1);
    });

    it('applies conservative thresholds consistently across the matrix', () => {
        for (const hf of [1.24, 1.25, 1.26, 1.29, 1.30, 1.31, 1.39, 1.40]) {
            const c = evaluateMarketConditions({ ...marketData, portfolio: { ...marketData.portfolio, healthFactor: hf } }, { riskAppetite: 'Conservative' });
            expect(c.isSafe).toBe(hf >= 1.30);
            expect(c.isWarning).toBe(hf >= 1.25 && hf < 1.30);
            expect(c.isCritical).toBe(hf < 1.25);
        }
    });

    it('applies aggressive thresholds consistently across the matrix', () => {
        for (const hf of [1.09, 1.10, 1.11, 1.14, 1.15, 1.16, 1.19, 1.20]) {
            const c = evaluateMarketConditions({ ...marketData, portfolio: { ...marketData.portfolio, healthFactor: hf } }, { riskAppetite: 'Aggressive' });
            expect(c.isSafe).toBe(hf >= 1.15);
            expect(c.isWarning).toBe(hf >= 1.10 && hf < 1.15);
            expect(c.isCritical).toBe(hf < 1.10);
        }
    });
});

// ---- Data-detailed: spread (yield-inversion) matrix ----
describe('evaluateMarketConditions — spread matrix', () => {
    it.each([
        [-3.0, true], [-1.0, true], [-0.01, true],
        [0.0, false], [0.01, false], [1.0, false], [2.0, false], [5.0, false],
    ])('baseSpread %s → isCritical=%s', (spread, critical) => {
        const c = evaluateMarketConditions({ ...marketData, baseSpread: spread }, { targetHf: 1.25 });
        expect(c.isCritical).toBe(critical);
    });
});

// ---- Data-detailed: claim profitability boundary ----
describe('evaluateMarketConditions — claim profitability boundary', () => {
    it.each([
        [1, true], [19, true], [19.99, true], [20, false], [20.01, false], [40, false],
    ])('gasPrice %s gwei (maxGasClaim 20) → isClaimProfitable=%s', (gasPrice, profitable) => {
        const c = evaluateMarketConditions({ ...marketData, gasPrice }, { maxGasClaim: 20 });
        expect(c.isClaimProfitable).toBe(profitable);
    });
});
