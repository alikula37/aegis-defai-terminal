// backend/core/tools/executor.js
// Faz 3 (B3-2) — Executes read-only tools with safety limits and an audit trail.
//
// Guarantees:
//   - Every call is recorded in an audit log (what the LLM saw, how long it took).
//   - Budget: maxCallsPerCycle — the LLM cannot drain the API or hang the cycle.
//   - Timeout: a hung handler never blocks the agent cycle.
//   - Write access is architecturally impossible: handlers only read via ctx.

import { getTool, validateToolArgs } from './registry.js';

const DEFAULT_MAX_CALLS = 6;
const DEFAULT_TIMEOUT_MS = 10000;

export function normalizeRawArgs(rawArgs) {
    // undefined → {} (caller omitted args); anything else is validated as-is,
    // so null/arrays/strings get rejected by the schema instead of swallowed.
    return rawArgs === undefined ? {} : rawArgs;
}

export class ToolExecutor {
    /**
     * @param {object} opts
     * @param {number} opts.maxCallsPerCycle tool calls allowed per agent cycle
     * @param {number} opts.timeoutMs per-call timeout
     * @param {Map<string, object>|null} opts.tools optional tool map override (tests)
     * @param {(entry: object) => void} opts.auditSink optional sink for audit entries (e.g. agent logs)
     */
    constructor({ maxCallsPerCycle = DEFAULT_MAX_CALLS, timeoutMs = DEFAULT_TIMEOUT_MS, tools = null, auditSink = null } = {}) {
        this.maxCallsPerCycle = maxCallsPerCycle;
        this.timeoutMs = timeoutMs;
        this.tools = tools;
        this.auditSink = auditSink;
        this.callsUsed = 0;
        this.auditLog = [];
    }

    _getTool(name) {
        if (this.tools) return this.tools.get(name) || null;
        return getTool(name);
    }

    get callsRemaining() {
        return Math.max(0, this.maxCallsPerCycle - this.callsUsed);
    }

    reset() {
        this.callsUsed = 0;
        this.auditLog = [];
    }

    getAuditLog() {
        return [...this.auditLog];
    }

    /**
     * Execute a tool. Never throws — returns a structured result so the LLM
     * loop and the agent can react to failures deterministically.
     * @returns {Promise<{ok: true, result: any} | {ok: false, error: string, detail?: any}>}
     */
    async execute(name, rawArgs = {}, ctx = {}) {
        const started = Date.now();
        const record = { name, args: rawArgs, startedAt: started };
        if (this.callsUsed >= this.maxCallsPerCycle) {
            record.ok = false;
            record.error = 'tool_call_budget_exhausted';
            return this._finish(record, { ok: false, error: 'tool_call_budget_exhausted', detail: { callsUsed: this.callsUsed, maxCallsPerCycle: this.maxCallsPerCycle } });
        }

        const tool = this._getTool(name);
        if (!tool) {
            record.ok = false;
            record.error = 'unknown_tool';
            return this._finish(record, { ok: false, error: `unknown_tool: ${name}` });
        }

        const validated = validateToolArgs(name, normalizeRawArgs(rawArgs));
        if (!validated.ok) {
            record.ok = false;
            record.error = 'invalid_args';
            return this._finish(record, { ok: false, error: 'invalid_args', detail: validated.issues });
        }

        this.callsUsed += 1;
        record.callsUsed = this.callsUsed;

        try {
            const result = await this._withTimeout(tool.handler(ctx, validated.args), name);
            record.ok = true;
            return this._finish(record, { ok: true, result });
        } catch (err) {
            record.ok = false;
            const message = err && err.code === 'TOOL_TIMEOUT'
                ? `tool_timeout (${this.timeoutMs}ms)`
                : `tool_error: ${err.message}`;
            record.error = message;
            return this._finish(record, { ok: false, error: message });
        }
    }

    _withTimeout(promise, name) {
        if (this.timeoutMs <= 0) return promise;
        let timer;
        const timeout = new Promise((_, reject) => {
            timer = setTimeout(() => {
                const err = new Error(`Tool ${name} timed out after ${this.timeoutMs}ms`);
                err.code = 'TOOL_TIMEOUT';
                reject(err);
            }, this.timeoutMs);
        });
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
    }

    _finish(record, result) {
        record.durationMs = Date.now() - record.startedAt;
        delete record.startedAt;
        this.auditLog.push(record);
        if (this.auditSink) {
            try {
                this.auditSink(record);
            } catch {
                // audit logging must never break the cycle
            }
        }
        return result;
    }
}
