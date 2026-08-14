// backend/execution/GasEstimator.js
// Pure gas-cost estimation helpers shared by the risk engine and both
// execution backends (simulation + onchain). All math is unit-testable.

export const GAS_LIMITS = {
    standard: 100000,   // baseline tx (used for risk-level gas cost)
    claim: 120000,      // reward claim
    rebalance: 250000,  // borrow + supply loop unwind/entry
    multicall: 350000,  // batched multi-step action
    flashLoan: 500000,  // flash loan rescue
};

export const MULTICALL_SAVINGS_FACTOR = 0.52; // batched gas = 52% of sequential

export function estimateGasUsd({ gasPriceGwei, ethPrice, gasLimit = GAS_LIMITS.standard }) {
    const gwei = Number(gasPriceGwei) || 0;
    const price = Number(ethPrice) || 0;
    const limit = Number(gasLimit) || GAS_LIMITS.standard;
    // gwei * 1e-9 = ETH, gasLimit applied, then multiplied by ETH/USD price
    return (gwei * limit * 1e-9) * price;
}

export function estimateMulticallGas({ gasCostUsd, numCalls = 3, savingsFactor = MULTICALL_SAVINGS_FACTOR }) {
    const sequentialGas = gasCostUsd * numCalls;
    const batchedGas = sequentialGas * savingsFactor;
    return {
        sequential: sequentialGas,
        batched: batchedGas,
        saved: sequentialGas - batchedGas,
    };
}
