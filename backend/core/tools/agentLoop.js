// backend/core/tools/agentLoop.js
// Faz 3 (B3-3) — tool-calling decision loop.
//
// Drives the LLM through up to maxRounds of tool use before demanding a final
// JSON decision. Hard guarantees:
//   - Tool calls are capped by the executor's per-cycle budget.
//   - Rounds are capped by maxRounds (no infinite loops).
//   - The final output must be parseable JSON → validated by the agent's
//     guardrail chain afterwards. Tool data NEVER becomes an action by itself.

import { listToolDefinitions } from './registry.js';
import { callLLMWithTools } from '../../services/LLMService.js';

/**
 * Robustly extract a JSON object from an LLM reply (strips markdown fences
 * and surrounding prose). Returns null when no JSON object is present.
 */
export function parseJsonContent(content) {
    if (typeof content !== 'string') return null;
    let text = content.trim();
    if (text.startsWith('```')) {
        text = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
    }
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start === -1 || end === -1 || end <= start) return null;
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return null;
    }
}

/**
 * Safely parse LLM-provided tool arguments (a JSON string).
 */
export function parseToolArgs(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') return {};
    try {
        return JSON.parse(raw);
    } catch {
        return {};
    }
}

/**
 * Run the tool-calling loop.
 *
 * @param {object} opts
 * @param {string} opts.prompt the decision prompt (buildLLMPrompt output)
 * @param {Array} opts.memoryContext recent decision memories
 * @param {object} opts.settings user settings (openRouterKey, activeModel, ...)
 * @param {boolean} opts.isCritical critical-zone flag (model routing)
 * @param {ToolExecutor} opts.executor tool budget + audit trail
 * @param {object} opts.ctx read-only data context for tool handlers
 * @param {number} opts.maxRounds max LLM rounds (default 3)
 * @param {Function} opts.callChat injectable chat client (tests)
 * @param {Function|null} opts.beforeRound optional async gate returning boolean (LLM budget)
 * @throws when no final JSON decision is produced (agent falls back deterministically)
 */
async function executeToolCalls(executor, toolCalls, ctx) {
    const results = [];
    for (const tc of toolCalls) {
        const out = await executor.execute(tc.function?.name || '', parseToolArgs(tc.function?.arguments), ctx);
        results.push({
            role: 'tool',
            tool_call_id: tc.id,
            content: JSON.stringify(out.ok ? { result: out.result } : { error: out.error }),
        });
    }
    return results;
}

export async function runToolAgent({
    prompt,
    memoryContext = [],
    settings = {},
    isCritical = false,
    executor,
    ctx = {},
    maxRounds = 3,
    callChat = callLLMWithTools,
    beforeRound = null,
} = {}) {
    const tools = listToolDefinitions();
    const toolMessages = [];
    let content = null;

    for (let round = 0; round < maxRounds; round++) {
        if (beforeRound) {
            const ok = await beforeRound(round);
            if (!ok) {
                throw new Error('LLM budget exhausted after tool rounds.');
            }
        }

        const res = await callChat({
            userPrompt: prompt,
            memoryContext,
            tools,
            toolMessages,
            settings,
            isCritical,
        });

        if (res.toolCalls && res.toolCalls.length) {
            toolMessages.push({
                role: 'assistant',
                content: res.content ?? null,
                tool_calls: res.toolCalls,
            });
            toolMessages.push(...await executeToolCalls(executor, res.toolCalls, ctx));

            // Budget guard: if the executor has nothing left, stop immediately
            // instead of asking the LLM to keep going.
            if (executor.callsRemaining === 0) break;
            continue;
        }

        content = res.content;
        break;
    }

    if (content === null) {
        throw new Error('LLM produced tool calls but no final JSON decision.');
    }

    const parsed = parseJsonContent(content);
    if (!parsed) {
        throw new Error('LLM tool-round content is not valid JSON.');
    }
    return parsed;
}
