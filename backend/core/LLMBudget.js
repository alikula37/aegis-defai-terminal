// backend/core/LLMBudget.js
// LLM cost control (Faz 2.8 + B3-7): per-cycle call cap, weekly spend cap and
// model routing policy. Critical decisions use a premium model while routine
// decisions stay on the cheap/default model.
import aegisConfig from '../aegis.config.js';

export const ROUTING_POLICY = {
    criticalModel: 'anthropic/claude-3.5-sonnet',
    routineModel: aegisConfig.llm.defaultModel,
};

/**
 * Model routing. The user's explicit selection always wins — for routine AND
 * critical decisions (they can pick any OpenRouter model in Settings). Only
 * when no model is configured do the defaults kick in: routine → routineModel,
 * critical → criticalModel.
 */
export function resolveModel(activeModel, isCritical, { criticalModel = ROUTING_POLICY.criticalModel } = {}) {
    if (activeModel) return activeModel;
    return isCritical ? criticalModel : ROUTING_POLICY.routineModel;
}

const WEEK_MS = 7 * 24 * 3600000;

/**
 * Faz 3 (B3-7) — does this OpenRouter model support tool/function calling?
 * Most modern models do; administrators can exclude specific models via
 * config `llm.tools.excludedModels`. Models without tool support silently use
 * the plain prompt path instead of failing.
 */
export function supportsTools(model, excludedModels = []) {
    if (typeof model !== 'string' || !model) return false;
    if (excludedModels.includes(model)) return false;
    return true;
}

/**
 * Faz 3 (B3-7) — budget with a weekly call cap on top of the per-cycle cap.
 * The week window is in-memory (resets on restart) — enough to stop runaway
 * spend within a long-running session.
 */
export class LLMBudget {
    constructor({ maxCallsPerCycle = 1, weeklyMaxCalls = 0 } = {}) {
        this.maxCallsPerCycle = maxCallsPerCycle;
        this.weeklyMaxCalls = weeklyMaxCalls;
        this.callsThisCycle = 0;
        this.weekStart = Date.now();
        this.callsThisWeek = 0;
    }

    beginCycle() {
        this.callsThisCycle = 0;
        this._rollWeek();
    }

    _rollWeek() {
        if (Date.now() - this.weekStart >= WEEK_MS) {
            this.weekStart = Date.now();
            this.callsThisWeek = 0;
        }
    }

    canCall() {
        return this.callsThisCycle < this.maxCallsPerCycle && this.weeklyRemaining > 0;
    }

    recordCall() {
        this._rollWeek();
        this.callsThisCycle += 1;
        this.callsThisWeek += 1;
        return this.callsThisCycle <= this.maxCallsPerCycle;
    }

    get weeklyRemaining() {
        if (this.weeklyMaxCalls <= 0) return Infinity;
        return Math.max(0, this.weeklyMaxCalls - this.callsThisWeek);
    }

    get weeklyExhausted() {
        return this.weeklyMaxCalls > 0 && this.callsThisWeek >= this.weeklyMaxCalls;
    }

    reset() {
        this.callsThisCycle = 0;
        this.callsThisWeek = 0;
        this.weekStart = Date.now();
    }
}
