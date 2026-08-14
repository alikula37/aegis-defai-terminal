// backend/execution/onchainSetup.js
// Builds the provider/signer pair for on-chain execution from environment
// configuration. Returns nulls when not configured — the execution backend then
// refuses to act (safe default).

import { JsonRpcProvider, Wallet } from 'ethers';
import { EXECUTION_MODES } from './ExecutionLayer.js';

const PLACEHOLDER_PRIVATE_KEY = 'kullanici_buraya_girecek';

export function resolveOnchainDeps({ rpcUrl, privateKey, chainId }) {
    if (!rpcUrl) return { provider: null, signer: null, address: null };
    let provider;
    try {
        provider = new JsonRpcProvider(rpcUrl, chainId || undefined);
    } catch (err) {
        return { provider: null, signer: null, address: null };
    }
    const hasKey = privateKey && privateKey !== PLACEHOLDER_PRIVATE_KEY;
    const signer = hasKey ? new Wallet(privateKey, provider) : null;
    return { provider, signer, address: signer ? signer.address : null };
}

/**
 * Resolves the effective execution mode ('simulation' | 'onchain').
 * Precedence: explicit option → EXECUTION_MODE env → aegis.config default.
 * Invalid values fall back to 'simulation' with a warning.
 */
export function resolveExecutionMode(explicitOption, configDefault) {
    const value = (explicitOption || process.env.EXECUTION_MODE || configDefault || 'simulation').toLowerCase();
    if (EXECUTION_MODES[value]) return value;
    console.warn(`[EXECUTION] Invalid execution mode "${value}". Falling back to "simulation".`);
    return 'simulation';
}
