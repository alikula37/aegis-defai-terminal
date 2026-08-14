import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Registry } from 'prom-client';
import { initTracing, resetTracing, trace, isTracingEnabled } from '../monitoring/tracing.js';

beforeEach(() => {
    resetTracing();
    vi.restoreAllMocks();
});

afterEach(() => {
    resetTracing();
});

describe('tracing (D8)', () => {
    it('trace() is a transparent no-op when tracing is disabled', async () => {
        expect(isTracingEnabled()).toBe(false);
        const spy = vi.fn(async () => 42);
        await expect(trace('aegis.cycle', spy)).resolves.toBe(42);
        expect(spy).toHaveBeenCalledOnce();
        await expect(trace('aegis.cycle', async () => { throw new Error('boom'); }))
            .rejects.toThrow('boom');
    });

    it('exported spans land in the prom-client registry as aegis_span_* metrics', async () => {
        const registry = new Registry();
        initTracing({ registry, enabled: true });
        expect(isTracingEnabled()).toBe(true);

        await trace('aegis.cycle', async () => {
            await new Promise((r) => setTimeout(r, 10));
        });
        // SimpleSpanProcessor flushes synchronously on end() for a done span.
        const rendered = await registry.metrics();
        expect(rendered).toContain('aegis_spans_total');
        expect(rendered).toContain('aegis_span_duration_seconds');
        // name label appears
        expect(rendered).toContain('aegis.cycle');
        // histogram sampled once
        expect(rendered).toContain('aegis_spans_total{name="aegis.cycle",status="ok"} 1');
    });

    it('records error status on the span when the traced fn throws', async () => {
        const registry = new Registry();
        initTracing({ registry, enabled: true });
        await expect(trace('aegis.llm', async () => { throw new Error('nope'); }))
            .rejects.toThrow('nope');
        const rendered = await registry.metrics();
        expect(rendered).toContain('aegis_spans_total{name="aegis.llm",status="error"} 1');
    });

    it('initTracing returns null when disabled and cleans up active state', () => {
        const registry = new Registry();
        expect(initTracing({ registry, enabled: false })).toBeNull();
        expect(isTracingEnabled()).toBe(false);
        resetTracing();
        expect(isTracingEnabled()).toBe(false);
    });

    it('re-initializing swaps to the new registry', async () => {
        const r1 = new Registry();
        initTracing({ registry: r1, enabled: true });
        await trace('aegis.cycle', async () => {});
        const r2 = new Registry();
        initTracing({ registry: r2, enabled: true });
        await trace('aegis.cycle', async () => {});
        expect(await r1.metrics()).toContain('aegis.cycle');
        expect(await r2.metrics()).toContain('aegis.cycle');
    });

    it('re-initializing on the SAME registry does not throw (idempotent)', async () => {
        const registry = new Registry();
        initTracing({ registry, enabled: true });
        await trace('aegis.cycle', async () => {});
        expect(() => initTracing({ registry, enabled: true })).not.toThrow();
        await trace('aegis.cycle', async () => {});
        expect(await registry.metrics()).toContain('aegis_spans_total');
    });
});
