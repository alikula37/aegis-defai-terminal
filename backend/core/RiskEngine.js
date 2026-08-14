// backend/core/RiskEngine.js
// Pure risk assessment. Consumes a market snapshot and simulation settings and
// returns the conditions object the decision engine and execution layer rely on.
import { GAS_LIMITS, estimateGasUsd } from '../execution/GasEstimator.js';

const DEFAULT_TARGET_HF = 1.25;
const WARNING_OFFSET = 0.04;
const CRITICAL_OFFSET = 0.10;

export function evaluateMarketConditions(marketData, simulationSettings = {}) {
    let targetHf = simulationSettings?.targetHf || DEFAULT_TARGET_HF;
    let warningHf = targetHf - WARNING_OFFSET;
    let criticalHf = targetHf - CRITICAL_OFFSET;

    // Fallback for older simulations that used riskAppetite
    if (simulationSettings?.riskAppetite === 'Conservative' && !simulationSettings?.targetHf) {
        targetHf = 1.40;
        warningHf = 1.30;
        criticalHf = 1.25;
    } else if (simulationSettings?.riskAppetite === 'Aggressive' && !simulationSettings?.targetHf) {
        targetHf = 1.20;
        warningHf = 1.15;
        criticalHf = 1.10;
    }

    const currentHf = marketData.portfolio.healthFactor;
    const isCritical = currentHf < criticalHf || marketData.baseSpread < 0;
    const isWarning = currentHf >= criticalHf && currentHf < warningHf;
    const isSafe = currentHf >= warningHf;

    const hourlyYield = (marketData.portfolio.netApy / 100) * marketData.portfolio.tvl / (365 * 24);
    const gasCostUsd = estimateGasUsd({
        gasPriceGwei: marketData.gasPrice,
        ethPrice: marketData.ethPrice,
        gasLimit: GAS_LIMITS.standard,
    });
    const estimatedClaimProfit = hourlyYield * 24;
    const maxGasClaim = simulationSettings?.maxGasClaim || 20;
    const isClaimProfitable = marketData.gasPrice < maxGasClaim;

    return {
        targetHf,
        warningHf,
        criticalHf,
        isCritical,
        isWarning,
        isSafe,
        hourlyYield,
        gasCostUsd,
        estimatedClaimProfit,
        isClaimProfitable,
        maxGasClaim,
    };
}

export const RISK_THRESHOLDS = {
    defaultTargetHf: DEFAULT_TARGET_HF,
    warningOffset: WARNING_OFFSET,
    criticalOffset: CRITICAL_OFFSET,
};
