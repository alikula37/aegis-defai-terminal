import { describe, it, expect } from 'vitest';
import { resolveOnchainDeps } from '../execution/onchainSetup.js';

const TEST_KEY = '0x' + 'ab'.repeat(32);

describe('resolveOnchainDeps', () => {
    it('returns null provider/signer when no RPC is configured', () => {
        const deps = resolveOnchainDeps({ rpcUrl: '', privateKey: TEST_KEY, chainId: 11155111 });
        expect(deps.provider).toBeNull();
        expect(deps.signer).toBeNull();
        expect(deps.address).toBeNull();
    });

    it('creates a provider but no signer when the private key is a placeholder', () => {
        const deps = resolveOnchainDeps({ rpcUrl: 'https://rpc.example.com', privateKey: 'kullanici_buraya_girecek', chainId: 11155111 });
        expect(deps.provider).toBeTruthy();
        expect(deps.signer).toBeNull();
        expect(deps.address).toBeNull();
    });

    it('creates both provider and signer for a real private key', () => {
        const deps = resolveOnchainDeps({ rpcUrl: 'https://rpc.example.com', privateKey: TEST_KEY, chainId: 11155111 });
        expect(deps.provider).toBeTruthy();
        expect(deps.signer).toBeTruthy();
        expect(typeof deps.signer.address).toBe('string');
        expect(deps.address).toBe(deps.signer.address);
    });
});
