// backend/monitoring/metrics.js
// Prometheus metrics for Aegis. `createMetrics()` returns a fresh set of
// metric objects + a `render()` helper so the /metrics endpoint and tests can
// share one registry. A per-instance registry keeps tests isolated.

import { Counter, Gauge, Histogram, Registry } from 'prom-client';

export function createMetrics(registry = new Registry()) {
    const httpRequests = new Counter({
        name: 'aegis_http_requests_total',
        help: 'Total HTTP requests handled',
        labelNames: ['method', 'route', 'status'],
        registers: [registry],
    });

    const httpDuration = new Histogram({
        name: 'aegis_http_duration_seconds',
        help: 'HTTP request duration in seconds',
        labelNames: ['method', 'route'],
        registers: [registry],
    });

    const wsClients = new Gauge({
        name: 'aegis_ws_clients',
        help: 'Number of connected WebSocket clients',
        registers: [registry],
    });

    const portfolioTvl = new Gauge({
        name: 'aegis_portfolio_tvl',
        help: 'Latest portfolio TVL in USD',
        registers: [registry],
    });

    const agentRunning = new Gauge({
        name: 'aegis_agent_running',
        help: '1 when the agent cycle is running, 0 otherwise',
        registers: [registry],
    });

    // ---- Faz 3 (B3-10): LLM / tool observability ----
    const toolCalls = new Counter({
        name: 'aegis_tool_calls_total',
        help: 'Read-only tool calls executed for the LLM',
        labelNames: ['tool', 'status'],
        registers: [registry],
    });

    const toolCallDuration = new Histogram({
        name: 'aegis_tool_call_duration_seconds',
        help: 'Tool execution duration in seconds',
        labelNames: ['tool'],
        registers: [registry],
    });

    const llmCalls = new Counter({
        name: 'aegis_llm_calls_total',
        help: 'LLM chat completions (each tool round counts)',
        labelNames: ['model', 'kind'],
        registers: [registry],
    });

    const llmCallsPerCycle = new Gauge({
        name: 'aegis_llm_calls_per_cycle',
        help: 'LLM calls in the current agent cycle',
        registers: [registry],
    });

    const toolCallsPerCycle = new Gauge({
        name: 'aegis_tool_calls_per_cycle',
        help: 'Tool calls in the current agent cycle',
        registers: [registry],
    });

    return {
        httpRequests,
        httpDuration,
        wsClients,
        portfolioTvl,
        agentRunning,
        toolCalls,
        toolCallDuration,
        llmCalls,
        llmCallsPerCycle,
        toolCallsPerCycle,
        render: () => registry.metrics(),
    };
}
