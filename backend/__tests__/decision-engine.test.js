import { describe, it, expect } from 'vitest';
import {
    deterministicFallback,
    validateLLMDecision,
    shouldCallLLM,
    buildLLMPrompt,
    buildStructuredReasoning,
    normalizeReasoning,
    estimateTokens,
    capPromptTokens,
} from '../core/DecisionEngine.js';
import { resolveModel, LLMBudget, supportsTools } from '../core/LLMBudget.js';

const marketData = {
    portfolio: {
        tvl: 10000,
        netApy: 15,
        healthFactor: 1.5,
        currentLtv: 0.8,
        currentCollateral: 'PT-sUSDe',
        allocations: { loop: 1, basis: 0, jit: 0 },
    },
    pendlePtSusdeApy: 8,
    hyperliquidFundingApy: 10,
    jitLiquidityApy: 30,
    netApy: 15,
    baseSpread: 2,
    leverage: 5,
    ethPrice: 2500,
    gasPrice: 15,
    aaveV4BorrowApy: 6,
    morphoBorrowApy: 6,
    crossChain: { isCrossChainArbitrageAvailable: false },
};

const state = { currentCollateral: 'PT-sUSDe', currentLtv: 0.8, currentBorrowProtocol: 'Morpho Blue', allocations: { loop: 1, basis: 0, jit: 0 } };
const safeConditions = { isCritical: false, isWarning: false, isSafe: true, targetHf: 1.25, criticalHf: 1.15, warningHf: 1.21, isClaimProfitable: true, maxGasClaim: 20, estimatedClaimProfit: 3, gasCostUsd: 1 };
const criticalConditions = { ...safeConditions, isCritical: true, isSafe: false };
const warningConditions = { ...safeConditions, isWarning: true, isSafe: false };

describe('deterministicFallback', () => {
    it('rescues with flash loan when critical', () => {
        const d = deterministicFallback(marketData, criticalConditions, state);
        expect(d.decision).toBe('flash_loan_rescue');
        expect(d.target_ltv).toBe(0);
    });

    it('de-leverages in warning zone', () => {
        const d = deterministicFallback(marketData, warningConditions, state);
        expect(d.decision).toBe('adjust_portfolio');
        expect(d.target_ltv).toBeCloseTo(0.7, 10);
    });

    it('claims when profitable and stable', () => {
        const d = deterministicFallback(marketData, safeConditions, state);
        expect(d.decision).toBe('claim');
    });

    it('holds when nothing is actionable', () => {
        const d = deterministicFallback(marketData, { ...safeConditions, isClaimProfitable: false }, state);
        expect(d.decision).toBe('hold');
    });

    it('prefers borrow migration when Aave is significantly cheaper', () => {
        const d = deterministicFallback({ ...marketData, aaveV4BorrowApy: 3, morphoBorrowApy: 6 }, { ...safeConditions, isClaimProfitable: false }, state);
        expect(d.decision).toBe('migrate_borrow');
    });
});

describe('validateLLMDecision', () => {
    it('overrides unearned flash_loan_rescue to hold', () => {
        const { response, warnings } = validateLLMDecision({ decision: 'flash_loan_rescue' }, marketData, safeConditions, state);
        expect(response.decision).toBe('hold');
        expect(warnings).toHaveLength(1);
    });

    it('overrides drastic LTV cut while safe', () => {
        const { response } = validateLLMDecision({ decision: 'adjust_portfolio', target_ltv: 0.2 }, marketData, safeConditions, state);
        expect(response.decision).toBe('hold');
    });

    it('allows drastic LTV cut in warning zone', () => {
        const { response } = validateLLMDecision({ decision: 'adjust_portfolio', target_ltv: 0.2 }, marketData, warningConditions, state);
        expect(response.decision).toBe('adjust_portfolio');
    });

    it('overrides claim when gas too high', () => {
        const { response, warnings } = validateLLMDecision({ decision: 'claim' }, { ...marketData, gasPrice: 40 }, { ...safeConditions, isClaimProfitable: false }, state);
        expect(response.decision).toBe('hold');
        expect(warnings[0]).toContain('40 gwei > 20 gwei');
    });

    it('passes valid decisions through untouched', () => {
        const decision = { decision: 'hold' };
        const { response, warnings } = validateLLMDecision(decision, marketData, safeConditions, state);
        expect(response).toEqual(decision);
        expect(warnings).toHaveLength(0);
    });

    // ---- Data-detailed: guardrail matrix (decision × zone × profitability) ----
    it.each([
        // [decision, target_ltv, conditions, expectedDecision]
        ['flash_loan_rescue', undefined, 'critical', 'flash_loan_rescue'],
        ['flash_loan_rescue', undefined, 'safe', 'hold'],
        ['flash_loan_rescue', undefined, 'warning', 'hold'],
        ['adjust_portfolio', 0.2, 'safe', 'hold'],          // drastic cut while safe
        ['adjust_portfolio', 0.2, 'warning', 'adjust_portfolio'],
        ['adjust_portfolio', 0.2, 'critical', 'adjust_portfolio'],
        ['adjust_portfolio', 0.75, 'safe', 'adjust_portfolio'], // mild cut (≥ -0.1) passes
        ['adjust_portfolio', 0.75, 'warning', 'adjust_portfolio'],
        ['claim', undefined, 'safe-profitable', 'claim'],
        ['claim', undefined, 'safe-not-profitable', 'hold'],
        ['claim', undefined, 'warning-profitable', 'claim'],
        ['rebalance', undefined, 'safe', 'rebalance'],
        ['unwind', undefined, 'critical', 'unwind'],
        ['hold', undefined, 'critical', 'hold'],
        ['migrate_borrow', undefined, 'warning', 'migrate_borrow'],
    ])('%s (ltv=%s, zone=%s) → %s', (decision, targetLtv, zone, expected) => {
        const conds = zone === 'critical'
            ? criticalConditions
            : zone === 'warning'
                ? warningConditions
                : zone.includes('not-profitable')
                    ? { ...safeConditions, isClaimProfitable: false }
                    : safeConditions;
        const payload = { decision, ...(targetLtv !== undefined ? { target_ltv: targetLtv } : {}) };
        const { response } = validateLLMDecision(payload, marketData, conds, state);
        expect(response.decision).toBe(expected);
    });
});

describe('shouldCallLLM', () => {
    it('always calls in critical conditions', () => {
        expect(shouldCallLLM(marketData, criticalConditions)).toBe(true);
    });

    it('skips the LLM when conditions are optimal', () => {
        const conditions = { ...safeConditions, isClaimProfitable: false };
        expect(shouldCallLLM({ ...marketData, gasPrice: 25 }, conditions)).toBe(false);
    });

    it('calls when a profitable claim exists', () => {
        const conditions = { ...safeConditions, isClaimProfitable: true };
        expect(shouldCallLLM({ ...marketData, gasPrice: 10 }, conditions)).toBe(true);
    });
});

describe('buildLLMPrompt', () => {
    it('includes decision options and current state', () => {
        const prompt = buildLLMPrompt(marketData, safeConditions, state);
        expect(prompt).toContain('Available Decisions');
        expect(prompt).toContain('Health Factor: 1.50');
        expect(prompt).toContain('"decision"');
    });
});

describe('resolveModel (LLM routing)', () => {
    it('honors the user-selected model for critical decisions', () => {
        expect(resolveModel('meta-llama/llama-3.1-70b-instruct', true)).toBe('meta-llama/llama-3.1-70b-instruct');
    });

    it('honors the user-selected model for routine decisions', () => {
        expect(resolveModel('google/gemini-2.5-flash-exp:free', false)).toBe('google/gemini-2.5-flash-exp:free');
    });

    it('falls back to the premium model only when nothing is selected AND the decision is critical', () => {
        expect(resolveModel('', true)).toBe('anthropic/claude-3.5-sonnet');
    });

    it('falls back to the routine default when nothing is selected', () => {
        expect(resolveModel('', false)).toBe('meta-llama/llama-3.1-70b-instruct');
    });
});

describe('LLMBudget', () => {
    it('limits LLM calls per cycle', () => {
        const budget = new LLMBudget({ maxCallsPerCycle: 1 });
        budget.beginCycle();
        expect(budget.canCall()).toBe(true);
        expect(budget.recordCall()).toBe(true);
        expect(budget.canCall()).toBe(false);
        expect(budget.recordCall()).toBe(false);
    });

    it('resets on a new cycle', () => {
        const budget = new LLMBudget();
        budget.recordCall();
        expect(budget.canCall()).toBe(false);
        budget.beginCycle();
        expect(budget.canCall()).toBe(true);
    });
});

describe('supportsTools (B3-7)', () => {
    it('accepts modern tool-capable models by default', () => {
        expect(supportsTools('openai/gpt-4o-mini')).toBe(true);
        expect(supportsTools('anthropic/claude-3.5-sonnet')).toBe(true);
        expect(supportsTools('meta-llama/llama-3.1-70b-instruct')).toBe(true);
    });

    it('rejects non-strings and empty values', () => {
        expect(supportsTools(null)).toBe(false);
        expect(supportsTools('')).toBe(false);
    });

    it('respects the admin exclusion list', () => {
        expect(supportsTools('some/model-without-tools', ['some/model-without-tools'])).toBe(false);
        expect(supportsTools('some/model-without-tools', [])).toBe(true);
    });
});

describe('LLMBudget weekly cap (B3-7)', () => {
    it('enforces a weekly call cap', () => {
        const budget = new LLMBudget({ maxCallsPerCycle: 10, weeklyMaxCalls: 3 });
        budget.beginCycle();
        expect(budget.weeklyExhausted).toBe(false);
        budget.recordCall();
        budget.recordCall();
        budget.recordCall();
        expect(budget.weeklyExhausted).toBe(true);
        expect(budget.canCall()).toBe(false);
    });

    it('treats weeklyMaxCalls 0 as unlimited', () => {
        const budget = new LLMBudget({ weeklyMaxCalls: 0 });
        budget.beginCycle();
        for (let i = 0; i < 5; i++) budget.recordCall();
        expect(budget.weeklyExhausted).toBe(false);
        expect(budget.weeklyRemaining).toBe(Infinity);
    });

    it('reset clears the weekly counters', () => {
        const budget = new LLMBudget({ maxCallsPerCycle: 10, weeklyMaxCalls: 3 });
        budget.beginCycle();
        budget.recordCall();
        budget.recordCall();
        budget.recordCall();
        expect(budget.weeklyExhausted).toBe(true);
        budget.reset();
        expect(budget.weeklyExhausted).toBe(false);
        expect(budget.canCall()).toBe(true);
    });
});

describe('buildStructuredReasoning (B3-4)', () => {
    it('derives a full structured reasoning baseline from real data', () => {
        const r = buildStructuredReasoning(marketData, safeConditions, 'claim', 'Claiming rewards');
        expect(r.situation).toContain('safe zone');
        expect(r.situation).toContain('2500');
        expect(r.analysis).toContain("'claim'");
        expect(r.alternatives.length).toBeGreaterThanOrEqual(3);
        expect(r.alternatives[0]).toContain('claim');
        expect(r.chosen).toBe('Claiming rewards');
    });

    it('flags the critical zone in the situation', () => {
        const r = buildStructuredReasoning(marketData, criticalConditions, 'flash_loan_rescue');
        expect(r.situation).toContain('CRITICAL');
        expect(r.alternatives[0]).toContain('flash_loan_rescue');
    });
});

describe('normalizeReasoning (B3-4)', () => {
    it('keeps valid LLM-provided structured reasoning', () => {
        const llm = {
            decision: 'hold',
            reasoning: {
                situation: 'situation text',
                analysis: 'analysis text',
                alternatives: ['a', 'b'],
                chosen: 'chosen text',
            },
            action: 'do nothing',
        };
        const out = normalizeReasoning(llm, marketData, safeConditions);
        expect(out.reasoningDetails).toEqual({
            situation: 'situation text',
            analysis: 'analysis text',
            alternatives: ['a', 'b'],
            chosen: 'chosen text',
        });
        expect(out.reasoning).toBe(llm.reasoning);
    });

    it('falls back to deterministic fields for missing parts', () => {
        const llm = { decision: 'hold', reasoning: { situation: 'only this' }, action: '' };
        const out = normalizeReasoning(llm, marketData, safeConditions);
        expect(out.reasoningDetails.situation).toBe('only this');
        expect(out.reasoningDetails.analysis).toBeTruthy();
        expect(out.reasoningDetails.alternatives.length).toBeGreaterThan(0);
        expect(out.reasoningDetails.chosen).toBeTruthy();
    });

    it('converts a plain-string reasoning into structured form', () => {
        const llm = { decision: 'hold', reasoning: 'plain string reasoning', action: 'a' };
        const out = normalizeReasoning(llm, marketData, safeConditions);
        expect(out.reasoningDetails.situation).toBeTruthy();
        expect(out.reasoningDetails.chosen).toBe('plain string reasoning');
    });

    it('handles completely missing reasoning without throwing', () => {
        const out = normalizeReasoning({ decision: 'hold', action: 'x' }, marketData, safeConditions);
        expect(out.reasoningDetails.situation).toContain('safe zone');
        expect(out.reasoningDetails.alternatives).toContain('hold — keep current position and wait for better conditions');
    });

    it('rejects malformed structured types (non-string fields)', () => {
        const llm = { decision: 'hold', reasoning: { situation: 42, analysis: [], alternatives: 'nope', chosen: {} }, action: '' };
        const out = normalizeReasoning(llm, marketData, safeConditions);
        expect(out.reasoningDetails.situation).toBeTruthy();
        expect(typeof out.reasoningDetails.situation).toBe('string');
        expect(Array.isArray(out.reasoningDetails.alternatives)).toBe(true);
    });
});

describe('prompt token guard (B3-6)', () => {
    it('estimates tokens from character count', () => {
        expect(estimateTokens('12345678')).toBe(2);
        expect(estimateTokens('')).toBe(0);
        expect(estimateTokens(null)).toBe(0);
    });

    it('keeps the prompt and memories when within budget', () => {
        const out = capPromptTokens(marketData, safeConditions, [{ market_state_json: 'x'.repeat(200) }], 9000);
        expect(out.prompt).toContain('You are Aegis');
        expect(out.memories).toHaveLength(1);
    });

    it('shrinks the memory context instead of truncating data', () => {
        const memories = [
            { market_state_json: 'a'.repeat(2000) },
            { market_state_json: 'b'.repeat(2000) },
            { market_state_json: 'c'.repeat(2000) },
        ];
        const out = capPromptTokens(marketData, safeConditions, memories, 200);
        expect(out.prompt).toContain('Current State:'); // data intact
        expect(out.memories.length).toBeLessThan(memories.length);
        for (const m of out.memories) {
            expect(m.market_state_json.length).toBeLessThanOrEqual(400);
        }
    });

    it('the prompt instructs structured reasoning (B3-4 schema)', () => {
        const prompt = buildLLMPrompt(marketData, safeConditions);
        expect(prompt).toContain('"situation"');
        expect(prompt).toContain('"alternatives"');
        expect(prompt).toContain('"chosen"');
        expect(prompt).toContain('reasoning is a REQUIRED structured object');
    });
});
