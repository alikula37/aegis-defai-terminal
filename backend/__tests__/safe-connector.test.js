import { describe, it, expect } from 'vitest';
import { computeSafeTxHash } from '../execution/connectors/SafeConnector.js';
import { parseEther } from 'ethers';

const base = {
    chainId: 11155111,
    safeAddress: '0x470BA2E0C3Cec24aA81f6Bb64B98A147632f18aD',
    to: '0x9767de120c29ca81Be56be02fC662b0513282435',
    value: parseEther('0.0005'),
    nonce: 0n,
};

describe('computeSafeTxHash', () => {
    it('is deterministic for identical inputs', () => {
        expect(computeSafeTxHash(base)).toBe(computeSafeTxHash(base));
    });

    it('changes when the nonce changes', () => {
        expect(computeSafeTxHash(base)).not.toBe(computeSafeTxHash({ ...base, nonce: 1n }));
    });

    it('changes when the target/value changes', () => {
        expect(computeSafeTxHash(base)).not.toBe(computeSafeTxHash({ ...base, value: parseEther('0.001') }));
        expect(computeSafeTxHash(base)).not.toBe(computeSafeTxHash({ ...base, to: '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14' }));
    });

    it('handles empty data and defaults', () => {
        const hash = computeSafeTxHash({ ...base, data: '0x' });
        expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
    });
});
