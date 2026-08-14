import { describe, it, expect } from 'vitest';
import { createMetrics } from '../monitoring/metrics.js';

describe('Faz 3 observability metrics (B3-10)', () => {
    it('exposes tool and LLM metrics on the registry', async () => {
        const metrics = createMetrics();
        metrics.toolCalls.labels('get_market_snapshot', 'ok').inc();
        metrics.toolCalls.labels('get_market_snapshot', 'error').inc();
        metrics.toolCallDuration.labels('run_backtest').observe(0.25);
        metrics.llmCalls.labels('meta-llama/llama-3.1-70b-instruct', 'tool').inc();
        metrics.llmCallsPerCycle.set(3);
        metrics.toolCallsPerCycle.set(2);

        const rendered = await metrics.render();
        expect(rendered).toContain('aegis_tool_calls_total{tool="get_market_snapshot",status="ok"} 1');
        expect(rendered).toContain('aegis_tool_calls_total{tool="get_market_snapshot",status="error"} 1');
        expect(rendered).toContain('aegis_tool_call_duration_seconds');
        expect(rendered).toContain('aegis_llm_calls_total{model="meta-llama/llama-3.1-70b-instruct",kind="tool"} 1');
        expect(rendered).toContain('aegis_llm_calls_per_cycle 3');
        expect(rendered).toContain('aegis_tool_calls_per_cycle 2');
    });

    it('keeps registries isolated between instances', async () => {
        const a = createMetrics();
        const b = createMetrics();
        a.llmCalls.labels('m', 'plain').inc();
        const renderedA = await a.render();
        const renderedB = await b.render();
        expect(renderedA).toContain('aegis_llm_calls_total{model="m",kind="plain"} 1');
        expect(renderedB).not.toContain('{model="m"');
    });
});
