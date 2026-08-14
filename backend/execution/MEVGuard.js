// backend/execution/MEVGuard.js
// MEV (maximal extractable value) protection scoring. Pure helpers used by both
// the simulation backend (to narrate the routing decision) and the onchain
// backend (to choose private vs public mempool submission).

export const SANDWICH_RISK_THRESHOLD = 0.8;

/**
 * Returns a sandwich risk score and routing recommendation.
 * Higher gas price and larger position size increase exposure.
 */
export function evaluateSandwichRisk({ gasPrice, positionSizeUsd }) {
    const gas = Number(gasPrice) || 0;
    const size = Number(positionSizeUsd) || 0;
    const score = (gas / 50) * (size / 100000);
    const highRisk = score > SANDWICH_RISK_THRESHOLD;
    return {
        score,
        risk: highRisk ? 'high' : 'low',
        privateMempool: highRisk,
    };
}

export function shouldUseFlashbots(risk) {
    return risk.privateMempool === true;
}
