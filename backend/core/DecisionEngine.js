// backend/core/DecisionEngine.js
// Pure decision logic. The SAME engine is used for both simulation and onchain
// execution — only the execution backend changes. These functions never call
// the network or the database; the agent orchestrates and persists.

export function deterministicFallback(marketData, conditions, simulationState) {
    const { isCritical, isWarning, targetHf, criticalHf, warningHf } = conditions;

    if (isCritical) {
        return {
            decision: 'flash_loan_rescue',
            target_ltv: 0.0,
            target_collateral: simulationState.currentCollateral,
            target_allocations: { loop: 1.0, basis: 0.0, jit: 0.0 },
            reasoning: `Health factor (${marketData.portfolio.healthFactor.toFixed(2)}) is below critical threshold (${criticalHf}). Immediate flash loan rescue required to prevent liquidation.`,
            action: 'Execute Flash Loan via Morpho Blue to repay debt and restore health factor.',
            logType: 'flash_loan'
        };
    }

    if (isWarning) {
        return {
            decision: 'adjust_portfolio',
            target_ltv: Math.max(0, simulationState.currentLtv - 0.1),
            target_collateral: simulationState.currentCollateral,
            target_allocations: simulationState.allocations,
            reasoning: `Health factor (${marketData.portfolio.healthFactor.toFixed(2)}) is in the warning zone (below ${warningHf}). Reducing LTV to restore target HF (${targetHf}).`,
            action: 'Partially unwinding position to reduce leverage.',
            logType: 'de_leverage'
        };
    }

    // Check Cross-Chain Arbitrage
    if (marketData.crossChain?.isCrossChainArbitrageAvailable) {
        return {
            decision: 'cross_chain_migrate',
            target_allocations: simulationState.allocations,
            reasoning: `Cross-chain borrow savings (${marketData.crossChain.crossChainSavings.toFixed(2)}% APY) exceed threshold.`,
            action: `Migrating borrow leg to ${marketData.crossChain.crossChainNetwork} via CCIP.`,
            logType: 'migrate'
        };
    }

    // Check L1 Borrow Migration (Aave V4 vs Morpho)
    if (simulationState.currentBorrowProtocol !== 'Aave V4 E-Mode' && marketData.aaveV4BorrowApy < marketData.morphoBorrowApy - 0.5) {
        return {
            decision: 'migrate_borrow',
            reasoning: `Aave V4 E-Mode offers significantly lower borrow rate than Morpho Blue.`,
            action: 'Migrating L1 borrow position to Aave V4.',
            logType: 'migrate'
        };
    }

    if (conditions.isClaimProfitable) {
        return {
            decision: 'claim',
            reasoning: `Estimated claim profit exceeds gas cost. Good opportunity to claim rewards.`,
            action: 'Claiming ENA and MORPHO rewards across all active positions.',
            logType: 'claim'
        };
    }

    return {
        decision: 'hold',
        reasoning: `Market conditions are stable. Health factor (${marketData.portfolio.healthFactor.toFixed(2)}) is safe.`,
        action: 'Scanning pools... No action required.',
        logType: 'scan'
    };
}

/**
 * Faz 3 (B3-4) — deterministic, auditable reasoning baseline. Every decision
 * carries { situation, analysis, alternatives, chosen }. When the LLM fails to
 * provide structured reasoning, these fields are derived from real data so the
 * UI can always show WHY a decision was made.
 */
export function buildStructuredReasoning(marketData, conditions, decision, action = '') {
    const hf = marketData.portfolio.healthFactor ?? 0;
    const spread = marketData.baseSpread ?? 0;
    const ltv = (marketData.portfolio.currentLtv ?? 0) * 100;
    const zone = conditions.isCritical ? 'CRITICAL' : conditions.isWarning ? 'warning' : 'safe';
    const zoneText = zone === 'CRITICAL'
        ? `CRITICAL — health factor ${hf.toFixed(2)} is below the critical threshold (${conditions.criticalHf})`
        : zone === 'warning'
            ? `warning — health factor ${hf.toFixed(2)} is in the warning band (< ${conditions.warningHf})`
            : `safe — health factor ${hf.toFixed(2)} is in the safe zone (target ${conditions.targetHf})`;

    const situation = `Market: ETH $${(marketData.ethPrice ?? 0).toFixed(0)}, net APY ${(marketData.netApy ?? 0).toFixed(2)}%, base spread ${spread.toFixed(2)}%, LTV ${ltv.toFixed(1)}%, leverage ${(marketData.leverage ?? 1).toFixed(2)}x, gas ${marketData.gasPrice ?? 0} gwei. Risk zone: ${zoneText}.`;
    const alternatives = ['hold — keep current position and wait for better conditions', 'adjust_portfolio — reduce/increase LTV or switch collateral', 'reallocate_capital — shift allocations between loop/basis/jit'];
    if (conditions.isClaimProfitable) alternatives.unshift('claim — collect pending ENA/MORPHO rewards');
    if (conditions.isCritical) alternatives.unshift('flash_loan_rescue — emergency debt reduction via flash loan');

    return {
        situation,
        analysis: `Decision '${decision}' is driven by the current market state: spread ${spread.toFixed(2)}%, HF ${hf.toFixed(2)} (${zone} zone), claim profitability ${conditions.isClaimProfitable ? 'yes' : 'no'}.`,
        alternatives,
        chosen: action || `Executing '${decision}' as the best risk-adjusted option.`,
    };
}

/**
 * Faz 3 (B3-4) — normalize a decision's reasoning into a structured form.
 * LLM-provided structured fields are kept; anything missing or malformed is
 * replaced with the deterministic derivation. Never throws.
 */
export function normalizeReasoning(response, marketData, conditions) {
    const decision = response.decision || 'hold';
    const action = typeof response.action === 'string' ? response.action : '';
    const fallback = buildStructuredReasoning(marketData, conditions, decision, action);

    const raw = response.reasoning;
    const isStructured = raw && typeof raw === 'object' && !Array.isArray(raw);

    const str = (v, fb) => (typeof v === 'string' && v.trim() ? v.trim() : fb);
    const arr = (v, fb) => (Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string') ? v : fb);

    response.reasoningDetails = {
        situation: str(isStructured ? raw.situation : null, fallback.situation),
        analysis: str(isStructured ? raw.analysis : null, fallback.analysis),
        alternatives: arr(isStructured ? raw.alternatives : null, fallback.alternatives),
        chosen: str(isStructured ? raw.chosen : (typeof raw === 'string' ? raw : null), fallback.chosen),
    };
    return response;
}

/**
 * Validates an LLM-produced decision against risk guardrails.
 * Returns `{ response, warnings }` — warnings are surfaced by the agent.
 */
export function validateLLMDecision(response, marketData, conditions, simulationState) {
    const warnings = [];
    let decision = { ...response };

    // If LLM says flash_loan_rescue, ensure we are actually in critical zone
    if (decision.decision === 'flash_loan_rescue' && !conditions.isCritical) {
        warnings.push(`🛡️ [Guardrail] LLM suggested flash_loan_rescue but HF (${marketData.portfolio.healthFactor.toFixed(2)}) is not critical. Overriding to hold.`);
        decision = { ...decision, decision: 'hold', action: 'Overridden by Risk Guardrail.' };
    }

    // If LLM says adjust_portfolio to reduce LTV, ensure we are at least in warning zone if it's a drastic reduction
    if (decision.decision === 'adjust_portfolio' && decision.target_ltv < simulationState.currentLtv - 0.1 && conditions.isSafe) {
        warnings.push(`🛡️ [Guardrail] LLM suggested drastic LTV reduction but HF (${marketData.portfolio.healthFactor.toFixed(2)}) is safe. Overriding to hold.`);
        decision = { ...decision, decision: 'hold', action: 'Overridden by Risk Guardrail.' };
    }

    // If LLM says claim, ensure it's actually profitable
    if (decision.decision === 'claim' && !conditions.isClaimProfitable) {
        const maxGas = conditions.maxGasClaim ?? 20;
        warnings.push(`🛡️ [Guardrail] LLM suggested claim but gas is too high (${marketData.gasPrice} gwei > ${maxGas} gwei). Overriding to hold.`);
        decision = { ...decision, decision: 'hold', action: 'Overridden by Risk Guardrail.' };
    }

    return { response: decision, warnings };
}

/**
 * LLM budget guard: skip the LLM call entirely when conditions are optimal so
 * API limits and cost stay low. Mirrors the legacy shortcut in the agent cycle.
 */
export function shouldCallLLM(marketData, conditions) {
    if (conditions.isCritical) return true;
    if (marketData.portfolio.healthFactor >= conditions.targetHf) {
        const gasTooHighForClaim = marketData.gasPrice >= 20;
        if (!conditions.isClaimProfitable || gasTooHighForClaim) return false;
    }
    return true;
}

export function buildLLMPrompt(marketData, conditions) {
    return `
You are Aegis, an autonomous delta-neutral DeFi agent.
Your objective is to maximize yield while strictly managing risk.
Respond ONLY in valid JSON format.

Risk Zones:
- Safe: HF >= ${conditions.warningHf}
- Warning: ${conditions.criticalHf} <= HF < ${conditions.warningHf}
- Critical: HF < ${conditions.criticalHf}

Available Decisions:
1. "hold": Market is stable, HF is in Safe zone.
2. "adjust_portfolio": Dynamically adjust LTV or switch collateral to optimize yield/risk.
3. "reallocate_capital": Shift TVL percentages between Loop, Basis, and JIT primitives to maximize blended APY.
4. "flash_loan_rescue": HF is in Critical zone. Emergency flash loan to prevent liquidation.
5. "claim": Estimated claim profit ($${conditions.estimatedClaimProfit.toFixed(2)}) exceeds gas cost ($${conditions.gasCostUsd.toFixed(2)}).
6. "migrate_borrow": L1 borrow rate is significantly cheaper elsewhere.
7. "cross_chain_migrate": L2 borrow rate offers significant savings AND current TVL exceeds the break-even TVL required to cover bridge costs.

Current State:
- Health Factor: ${marketData.portfolio.healthFactor.toFixed(2)}
- Target HF: ${conditions.targetHf}
- Current LTV: ${(marketData.portfolio.currentLtv * 100).toFixed(1)}% (Leverage: ${marketData.leverage.toFixed(2)}x)
- Current Collateral: ${marketData.portfolio.currentCollateral}
- Current Allocations: Loop: ${(marketData.portfolio.allocations.loop * 100).toFixed(0)}%, Basis: ${(marketData.portfolio.allocations.basis * 100).toFixed(0)}%, JIT: ${(marketData.portfolio.allocations.jit * 100).toFixed(0)}%
- Loop APY (sUSDe/PT-sUSDe): ${marketData.portfolio.collateralApy ? marketData.portfolio.collateralApy.toFixed(2) : marketData.pendlePtSusdeApy.toFixed(2)}%
- Basis APY (Hyperliquid): ${marketData.hyperliquidFundingApy.toFixed(2)}%
- JIT APY (Uniswap): ${marketData.jitLiquidityApy.toFixed(2)}%
- Blended Net APY: ${marketData.netApy.toFixed(2)}%
- Base Spread: ${marketData.baseSpread.toFixed(2)}%
- Current TVL: $${marketData.portfolio.tvl.toFixed(2)}
- Break-even TVL for Cross-Chain: $${marketData.crossChain.minViableTvl ? marketData.crossChain.minViableTvl.toFixed(2) : 'N/A'}

JSON Schema:
{
  "decision": "hold" | "adjust_portfolio" | "reallocate_capital" | "flash_loan_rescue" | "claim" | "migrate_borrow" | "cross_chain_migrate",
  "target_ltv": 0.80,
  "target_collateral": "sUSDe" | "PT-sUSDe",
  "target_allocations": { "loop": 1.0, "basis": 0.0, "jit": 0.0 },
  "reasoning": {
    "situation": "One sentence: the current market/portfolio state",
    "analysis": "One sentence: what the data (APYs, spread, HF, tools) implies",
    "alternatives": ["briefly considered option 1", "briefly considered option 2"],
    "chosen": "One sentence: why this decision is the best risk-adjusted option"
  },
  "action": "Description of the specific action to be taken."
}

Rules:
- reasoning is a REQUIRED structured object with exactly those four fields.
- Use the provided tools (get_market_snapshot, get_historical_yields, run_backtest, etc.) BEFORE deciding when they would change your analysis. Tools are read-only data.
- You may use tools at most once each. After at most 2-3 tool rounds, produce the final decision JSON above.
- Never invent numbers not present in the data you were given.`;
}

/**
 * Faz 3 (B3-6) — rough token estimate (~4 chars/token) and a truncation guard
 * that keeps the LLM prompt inside the model budget. Memories are the first
 * thing dropped/compacted when the prompt grows too large.
 */
export function estimateTokens(text) {
    if (typeof text !== 'string') return 0;
    return Math.ceil(text.length / 4);
}

export function capPromptTokens(marketData, conditions, memories = [], maxTokens = 9000) {
    const prompt = buildLLMPrompt(marketData, conditions);
    const promptTokens = estimateTokens(prompt);
    if (promptTokens <= maxTokens) return { prompt, memories };

    // Prompt too large → shrink the memory context instead of truncating the
    // data (the data is more important for the decision).
    const memoryBudgetTokens = Math.max(0, maxTokens - promptTokens);
    const kept = [];
    let used = 0;
    for (const mem of memories) {
        const text = typeof mem.market_state_json === 'string' ? mem.market_state_json : '';
        const trimmed = text.slice(0, 400);
        const cost = estimateTokens(trimmed) + 40;
        if (used + cost > memoryBudgetTokens) break;
        kept.push({ ...mem, market_state_json: trimmed });
        used += cost;
    }
    return { prompt, memories: kept };
}
