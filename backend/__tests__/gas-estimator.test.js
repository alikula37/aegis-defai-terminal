import { describe, it, expect } from 'vitest';
import { estimateGasUsd, estimateMulticallGas, GAS_LIMITS, MULTICALL_SAVINGS_FACTOR } from '../execution/GasEstimator.js';

describe('GasEstimator (B2.5-9 coverage)', () => {
    it('computes standard gas cost in USD', () => {
        // 15 gwei * 100k * 1e-9 = 0.0015 ETH * 2500 = $3.75
        expect(estimateGasUsd({ gasPriceGwei: 15, ethPrice: 2500 })).toBeCloseTo(3.75, 10);
    });

    it('applies custom gas limits', () => {
        const claim = estimateGasUsd({ gasPriceGwei: 10, ethPrice: 3000, gasLimit: GAS_LIMITS.claim });
        expect(claim).toBeCloseTo(10 * 120000 * 1e-9 * 3000, 10);
    });

    it('handles missing/zero inputs safely', () => {
        expect(estimateGasUsd({})).toBe(0);
        expect(estimateGasUsd({ gasPriceGwei: null, ethPrice: undefined, gasLimit: 0 })).toBe(0);
    });

    it('computes multicall savings with the configured factor', () => {
        const r = estimateMulticallGas({ gasCostUsd: 1, numCalls: 3 });
        expect(r.sequential).toBe(3);
        expect(r.batched).toBeCloseTo(3 * MULTICALL_SAVINGS_FACTOR, 10);
        expect(r.saved).toBeCloseTo(r.sequential - r.batched, 10);
    });

    it('defaults multicall numCalls to 3', () => {
        const r = estimateMulticallGas({ gasCostUsd: 2 });
        expect(r.sequential).toBe(6);
    });

    it('exposes the standard gas limit constants', () => {
        expect(GAS_LIMITS.flashLoan).toBe(500000);
        expect(GAS_LIMITS.multicall).toBe(350000);
    });

    // ---- Data-detailed: gas price × ETH price × limit matrix ----
    it.each([
        [1, 1500, GAS_LIMITS.standard],
        [15, 2500, GAS_LIMITS.standard],
        [50, 5000, GAS_LIMITS.standard],
        [200, 3000, GAS_LIMITS.standard],
        [15, 2500, GAS_LIMITS.claim],
        [15, 2500, GAS_LIMITS.flashLoan],
        [30, 4000, GAS_LIMITS.multicall],
    ])('gas %s gwei × ETH $%s × limit %s → exact formula', (gasPriceGwei, ethPrice, gasLimit) => {
        const expected = (gasPriceGwei * gasLimit * 1e-9) * ethPrice;
        expect(estimateGasUsd({ gasPriceGwei, ethPrice, gasLimit })).toBeCloseTo(expected, 9);
        // default limit == standard
        if (gasLimit === GAS_LIMITS.standard) {
            expect(estimateGasUsd({ gasPriceGwei, ethPrice })).toBeCloseTo(expected, 9);
        }
    });

    it.each([
        // gasLimit 0 is falsy → default standard limit (15 gwei × 100k × $2500)
        [{ gasPriceGwei: 15, ethPrice: 2500, gasLimit: 0 }, 3.75],
        [{ gasPriceGwei: -1, ethPrice: 2500 }, 0],
        [{ gasPriceGwei: 15, ethPrice: -1 }, 0],
        [{ gasPriceGwei: 'abc', ethPrice: 2500 }, 0],
        [{ gasPriceGwei: null, ethPrice: null }, 0],
        [{}, 0],
    ])('degenerate input %j → %s', (input, expected) => {
        expect(estimateGasUsd(input)).toBeCloseTo(expected, 9);
    });
});
