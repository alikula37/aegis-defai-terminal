// backend/monitoring/tracing.js
// Phase 4 (D8) — OpenTelemetry tracing that exports span samples straight into
// the existing prom-client registry (served by /metrics). No Jaeger/OTLP
// collector required: enable with OTEL_ENABLED=true and every
// `trace('aegis.cycle', ...)` / LLM / onchain span shows up as
// `aegis_span_duration_seconds` + `aegis_spans_total` histograms/counters.
//
// When tracing is not initialized (or disabled), `trace()` is a cheap no-op
// pass-through so call sites can stay unconditional.

import { NodeTracerProvider, SimpleSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { ExportResultCode } from '@opentelemetry/core';
import { Histogram, Counter } from 'prom-client';

let activeTracer = null;

// Passed to callbacks when tracing is disabled so call sites can use
// `span.setAttribute(...)` unconditionally without null-guards.
const NOOP_SPAN = {
    setAttribute() {},
    setStatus() {},
    recordException() {},
    end() {},
};

/**
 * Minimal OTel SpanExporter that folds exported spans into a prom-client
 * registry. Kept inside this module so we never depend on the SDK's own
 * registry — the /metrics endpoint keeps serving a single source of truth.
 */
class PromRegistrySpanExporter {
    constructor({ registry, spanDuration, spansTotal }) {
        this.registry = registry;
        this.spanDuration = spanDuration;
        this.spansTotal = spansTotal;
    }

    export(readableSpans, resultCallback) {
        for (const span of readableSpans) {
            const [sec, ns] = span.duration || [0, 0];
            // OTel SpanStatusCode: UNSET=0, OK=1, ERROR=2
            const status = Number(span.status?.code ?? 0) === 2 ? 'error' : 'ok';
            const name = String(span.name || 'unknown');
            try {
                this.spansTotal.labels(name, status).inc();
                this.spanDuration.labels(name).observe(sec + ns / 1e9);
            } catch (_) {
                // A metric-label mismatch must never break the span pipeline.
            }
        }
        if (resultCallback) resultCallback({ code: ExportResultCode.SUCCESS });
    }

    shutdown() {
        return Promise.resolve();
    }
}

/**
 * Enable tracing. `registry` is the shared prom-client Registry so spans and
 * HTTP/agent metrics land on the same /metrics output. Returns the created
 * provider (or null when disabled).
 */
export function initTracing({ registry, enabled = false } = {}) {
    if (!enabled) {
        activeTracer = null;
        return null;
    }
    // Idempotent: a re-init on the same registry (hot reload, tests reusing the
    // server registry) must not throw on duplicate metric registration.
    try { registry.removeSingleMetric('aegis_spans_total'); } catch (_) { /* ignore */ }
    try { registry.removeSingleMetric('aegis_span_duration_seconds'); } catch (_) { /* ignore */ }
    const spanDuration = new Histogram({
        name: 'aegis_span_duration_seconds',
        help: 'OpenTelemetry span duration in seconds',
        labelNames: ['name'],
        registers: [registry],
    });
    const spansTotal = new Counter({
        name: 'aegis_spans_total',
        help: 'OpenTelemetry spans exported',
        labelNames: ['name', 'status'],
        registers: [registry],
    });
    const exporter = new PromRegistrySpanExporter({ registry, spanDuration, spansTotal });
    // OTel SDK v2: processors are passed via the provider constructor
    // (`spanProcessors`), not an `addSpanProcessor()` method.
    const provider = new NodeTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] });
    provider.register();
    activeTracer = provider.getTracer('aegis');
    return provider;
}

export function resetTracing() {
    activeTracer = null;
}

/**
 * Run `fn` inside a span. When tracing is disabled this is a plain await of
 * `fn()` — zero overhead, no instrumentation objects allocated. Failures are
 * recorded on the span and rethrown so call sites keep their normal control flow.
 */
export async function trace(name, fn, attributes) {
    if (!activeTracer) return fn(NOOP_SPAN);
    const span = activeTracer.startSpan(name, attributes ? { attributes } : undefined);
    try {
        const result = await fn(span);
        span.end();
        return result;
    } catch (err) {
        try {
            span.recordException(err);
            span.setStatus({ code: 2, message: err?.message || String(err) });
        } catch (_) { /* ignore instrumentation errors */ }
        span.end();
        throw err;
    }
}

export function isTracingEnabled() {
    return Boolean(activeTracer);
}
