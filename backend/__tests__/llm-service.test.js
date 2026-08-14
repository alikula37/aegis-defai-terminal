import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node-fetch', () => ({ default: vi.fn() }));

import fetch from 'node-fetch';
import { callLLM, callLLMWithTools, isRetriableLLMError, withModelFallback } from '../services/LLMService.js';

function jsonResponse(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 429 ? 'Too Many Requests' : status === 500 ? 'Internal Server Error' : 'OK',
        json: async () => body,
    };
}

const SUCCESS = { choices: [{ message: { content: JSON.stringify({ decision: 'hold' }) } }] };

describe('LLMService fallback chain (B2.5-8)', () => {
    beforeEach(() => {
        fetch.mockReset();
    });

    it('retries with the fallback model on a 5xx error', async () => {
        const calls = [];
        fetch.mockImplementation(async (url, opts) => {
            calls.push(JSON.parse(opts.body).model);
            if (calls.length === 1) return jsonResponse({}, 500);
            return jsonResponse(SUCCESS);
        });
        const settings = { openRouterKey: 'sk-test', activeModel: 'meta-llama/llama-3.1-70b-instruct' };
        const decision = await callLLM('prompt', false, [], settings);
        expect(decision.decision).toBe('hold');
        expect(calls).toHaveLength(2);
        expect(calls[0]).toBe('meta-llama/llama-3.1-70b-instruct');
        expect(calls[1]).toBe('openai/gpt-4o-mini'); // config fallbackModel
    });

    it('does NOT retry on auth/validation errors (4xx)', async () => {
        const calls = [];
        fetch.mockImplementation(async (url, opts) => {
            calls.push(JSON.parse(opts.body).model);
            return jsonResponse({}, 401);
        });
        const settings = { openRouterKey: 'sk-test', activeModel: 'meta-llama/llama-3.1-70b-instruct' };
        await expect(callLLM('p', false, [], settings)).rejects.toThrow('OpenRouter API error');
        expect(calls).toHaveLength(1);
    });

    it('retries tool-calling completions with the fallback model', async () => {
        const calls = [];
        fetch.mockImplementation(async (url, opts) => {
            calls.push(JSON.parse(opts.body).model);
            if (calls.length === 1) return jsonResponse({}, 429);
            return jsonResponse({ choices: [{ message: { content: null, tool_calls: [] } }] });
        });
        const settings = { openRouterKey: 'sk-test', activeModel: 'm' };
        const res = await callLLMWithTools({ userPrompt: 'p', tools: [], settings });
        expect(res.content).toBeNull();
        expect(calls).toHaveLength(2);
        expect(calls[1]).toBe('openai/gpt-4o-mini');
    });

    it('classifies retriable errors correctly', () => {
        const abort = new Error('aborted');
        abort.name = 'AbortError';
        expect(isRetriableLLMError(abort)).toBe(true);
        expect(isRetriableLLMError({ status: 429 })).toBe(true);
        expect(isRetriableLLMError({ status: 503 })).toBe(true);
        expect(isRetriableLLMError({ status: 401 })).toBe(false);
        expect(isRetriableLLMError({ status: 400 })).toBe(false);
        expect(isRetriableLLMError({ message: 'fetch failed' })).toBe(true);
        expect(isRetriableLLMError(null)).toBe(false);
    });

    it('withModelFallback rethrows non-retriable errors untouched', async () => {
        const err = new Error('auth');
        err.status = 401;
        await expect(withModelFallback(async () => { throw err; }, 'fb')).rejects.toBe(err);
    });

    it('withModelFallback passes the fallbackModel flag on retry', async () => {
        let attempts = 0;
        const fn = vi.fn(async ({ fallbackModel } = {}) => {
            attempts += 1;
            if (!fallbackModel) {
                const err = new Error('boom');
                err.status = 500;
                throw err;
            }
            return 'ok';
        });
        const result = await withModelFallback(fn, 'openai/gpt-4o-mini');
        expect(result).toBe('ok');
        expect(attempts).toBe(2);
    });
});
