import fetch from 'node-fetch';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { resolveModel } from '../core/LLMBudget.js';
import aegisConfig from '../aegis.config.js';
import { trace } from '../monitoring/tracing.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const characterPath = path.join(__dirname, '..', 'character.json');
let characterData = null;
try {
    characterData = JSON.parse(fs.readFileSync(characterPath, 'utf8'));
} catch (e) {
    console.error('Failed to load character.json:', e);
}


export function getApiKey(settings = {}) {
    const apiKey = settings.openRouterKey || process.env.OPENROUTER_API_KEY;
    if (!apiKey || apiKey === 'kullanici_buraya_girecek') {
        throw new Error('OpenRouter API Key is missing or invalid.');
    }
    return apiKey;
}

// Live OpenRouter model catalog (GET /api/llm/models): fetched once, cached
// for 30 minutes. The models endpoint is public — no API key required — but we
// send the key when one exists so the catalog also reflects paid/whitelisted
// models of the account.
const CATALOG_CACHE_TTL_MS = 30 * 60 * 1000;
export let catalogCache = { fetchedAt: 0, models: [] };

export function clearModelCatalogCache() {
    catalogCache = { fetchedAt: 0, models: [] };
}

export async function fetchModelCatalog(force = false) {
    if (!force && Date.now() - catalogCache.fetchedAt < CATALOG_CACHE_TTL_MS) {
        return catalogCache.models;
    }
    const key = process.env.OPENROUTER_API_KEY;
    const headers = { 'Content-Type': 'application/json' };
    if (key && key !== 'kullanici_buraya_girecek') headers['Authorization'] = `Bearer ${key}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);
    try {
        const response = await fetch('https://openrouter.ai/api/v1/models', { headers, signal: controller.signal });
        if (!response.ok) {
            throw new Error(`OpenRouter models API error: ${response.statusText}`);
        }
        const body = await response.json();
        // Sort: free models first (cheapest experiments), then alphabetically by id.
        const models = (body.data || [])
            .filter(m => m && m.id)
            .map(m => ({
                id: m.id,
                name: m.name || m.id,
                contextLength: m.context_length || 0,
                pricing: m.pricing || null,
                isFree: m.pricing ? Number(m.pricing.prompt) === 0 : /:free$/.test(m.id),
            }))
            .sort((a, b) => (a.isFree === b.isFree ? a.id.localeCompare(b.id) : a.isFree ? -1 : 1));
        catalogCache = { fetchedAt: Date.now(), models };
        return models;
    } finally {
        clearTimeout(timeoutId);
    }
}

/** Assemble the system prompt (character persona + decision memory context). */
export function buildSystemContent(memoryContext = []) {
    let systemContent = 'You are Aegis, an autonomous DeFi portfolio manager AI agent. Respond in JSON format only. Do not include markdown formatting or explanations outside the JSON.';

    if (characterData) {
        systemContent = `You are ${characterData.name}. ${characterData.description}\n\n`;
        systemContent += `Bio:\n${characterData.bio.join(' ')}\n\n`;
        systemContent += `Rules:\n- ${characterData.rules.join('\n- ')}\n\n`;
        systemContent += `Personality: Risk Tolerance: ${characterData.personality.riskTolerance}, Decision Style: ${characterData.personality.decisionStyle}\n\n`;
        systemContent += `Respond in JSON format only. Do not include markdown formatting or explanations outside the JSON.`;
    }

    if (memoryContext && memoryContext.length > 0) {
        systemContent += '\n\nHere is your recent decision memory (use this to learn from past mistakes/successes):\n';
        memoryContext.forEach((mem, i) => {
            systemContent += `[Memory ${i + 1}] Market State: ${mem.market_state_json} | Action: ${mem.action_taken} | Success: ${mem.is_successful === 1} | PnL: ${mem.profit_loss}\n`;
        });
    }
    return systemContent;
}

async function fetchChatCompletion(apiKey, body) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
        // Phase 4 (D8) — trace the LLM call (no-op when tracing disabled)
        return await trace('aegis.llm', async (span) => {
            span.setAttribute('model', String(body.model || ''));
            const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${apiKey}`,
                    'Content-Type': 'application/json',
                    'HTTP-Referer': 'http://localhost:3001',
                    'X-Title': 'Aegis DeFAI Terminal',
                },
                body: JSON.stringify(body),
                signal: controller.signal
            });

            if (!response.ok) {
                const err = new Error(`OpenRouter API error: ${response.statusText}`);
                err.status = response.status;
                throw err;
            }

            return await response.json();
        }, { model: String(body.model || '') });
    } finally {
        // Clear the abort timer even when fetch rejects at the network layer
        clearTimeout(timeoutId);
    }
}

/**
 * Faz 2.5 (B2.5-8) — is the error retriable with a different model?
 * Auth/validation errors (4xx) won't be fixed by switching models; server
 * errors, rate limits and timeouts might be.
 */
export function isRetriableLLMError(error) {
    if (!error) return false;
    if (error.name === 'AbortError') return true;
    if (typeof error.status === 'number') return error.status >= 429;
    if (typeof error.code === 'string' && error.code === 'UND_ERR_ABORTED') return true;
    // network-level failures (fetch threw without an HTTP status)
    if (error.status === undefined && error.code === undefined && error.message) return true;
    return false;
}

/**
 * Faz 2.5 (B2.5-8) — retry a chat completion once with the fallback model when
 * the primary model fails with a retriable error (5xx/429/timeout/network).
 */
export async function withModelFallback(primaryFn, fallbackModel, enabled = true) {
    if (!enabled || !fallbackModel) return primaryFn();
    try {
        return await primaryFn();
    } catch (error) {
        if (!isRetriableLLMError(error)) throw error;
        console.error(`LLM primary model failed (${error.message}); retrying with fallback model ${fallbackModel}`);
        return await primaryFn({ fallbackModel });
    }
}

export async function callLLM(prompt, isCritical = false, memoryContext = [], settings = {}) {
    const apiKey = getApiKey(settings);

    // Cost optimization: Llama 3.1 70B for routine, Claude 3.5 Sonnet for critical decisions
    // If user selected a free model in settings, use it for everything to avoid credit errors
    const activeModel = settings.activeModel || 'meta-llama/llama-3.1-70b-instruct';
    const model = resolveModel(activeModel, isCritical);

    const data = await withModelFallback(({ fallbackModel } = {}) => fetchChatCompletion(apiKey, {
        model: fallbackModel || model,
        messages: [
            { role: 'system', content: buildSystemContent(memoryContext) },
            { role: 'user', content: prompt }
        ],
        response_format: { type: 'json_object' }
    }), aegisConfig.llm.fallbackModel, aegisConfig.agent.llmFallbackRetry);

    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('Invalid response format from OpenRouter API: ' + JSON.stringify(data));
    }
    return JSON.parse(content);
}

/**
 * Faz 3 (B3-3) — chat completion that MAY return tool calls.
 * Used by the tool-calling agent loop: the model can query read-only tools
 * before producing its final JSON decision.
 *
 * @returns {Promise<{content: string|null, toolCalls: Array}>}
 */
export async function callLLMWithTools({
    userPrompt,
    memoryContext = [],
    tools = null,
    toolMessages = [],
    settings = {},
    isCritical = false,
} = {}) {
    const apiKey = getApiKey(settings);
    const activeModel = settings.activeModel || 'meta-llama/llama-3.1-70b-instruct';
    const model = resolveModel(activeModel, isCritical);

    const data = await withModelFallback(({ fallbackModel } = {}) => {
        const body = {
            model: fallbackModel || model,
            messages: [
                { role: 'system', content: buildSystemContent(memoryContext) },
                { role: 'user', content: userPrompt },
                ...toolMessages,
            ],
        };

        if (tools && tools.length) {
            body.tools = tools;
            body.tool_choice = 'auto';
        } else {
            // Tools absent → JSON-only mode (backwards-compatible)
            body.response_format = { type: 'json_object' };
        }
        return fetchChatCompletion(apiKey, body);
    }, aegisConfig.llm.fallbackModel, aegisConfig.agent.llmFallbackRetry);

    const msg = data?.choices?.[0]?.message;
    if (!msg) {
        throw new Error('Invalid response format from OpenRouter API: ' + JSON.stringify(data));
    }
    return {
        content: msg.content ?? null,
        toolCalls: Array.isArray(msg.tool_calls) ? msg.tool_calls : [],
    };
}

