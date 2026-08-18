import { describe, it, expect } from 'vitest';
import { forecast, holtLinear } from '../core/quant/ForecastService.js';

describe('ForecastService.holtLinear', () => {
    it('constant series → zero error, level = value', () => {
        const fit = holtLinear([5, 5, 5, 5, 5], { alpha: 0.4, beta: 0.2 });
        expect(fit.lastLevel).toBe(5);
        expect(fit.lastTrend).toBe(0);
        expect(fit.rmse).toBeLessThan(1e-9);
        expect(fit.mae).toBeLessThan(1e-9);
    });

    it('linear series → trend is captured and last point tracked', () => {
        const fit = holtLinear([1, 2, 3, 4, 5], { alpha: 0.9, beta: 0.9 });
        expect(fit.lastTrend).toBeGreaterThan(0.5);
        expect(fit.fitted.length).toBe(5);
    });

    it('empty series → empty result, no NaN', () => {
        const fit = holtLinear([]);
        expect(fit.lastLevel).toBeNull();
        expect(fit.mse).toBe(0);
    });
});

describe('ForecastService.forecast', () => {
    it('returns empty result for empty input', () => {
        const out = forecast({ values: [] });
        expect(out.future).toEqual([]);
        expect(out.lastLevel).toBeNull();
        expect(out.annualizedVolatilityPct).toBe(0);
    });

    it('constant series → flat forecast, zero width', () => {
        const out = forecast({ values: [5, 5, 5, 5], horizon: 3 });
        for (const f of out.future) {
            expect(f.value).toBeCloseTo(5, 1);
            expect(f.upper - f.lower).toBeLessThan(1e-6);
        }
        expect(out.trendPerPeriodPct).toBe(0);
    });

    it('upward-trending series → forecast continues upward', () => {
        const out = forecast({ values: [1, 2, 3, 4, 5, 6], horizon: 3, alpha: 0.8, beta: 0.6 });
        expect(out.future[0].value).toBeGreaterThan(6);
        // monotonic increasing forecast
        expect(out.future[2].value).toBeGreaterThan(out.future[1].value);
        expect(out.future[1].value).toBeGreaterThan(out.future[0].value);
        expect(out.trendAnnualizedPct).toBeGreaterThan(0);
    });

    it('band widens with horizon (sqrt-h growth)', () => {
        const out = forecast({ values: [1, 3, 2, 4, 3, 5], horizon: 5, alpha: 0.5, beta: 0.3 });
        const w1 = out.future[0].upper - out.future[0].lower;
        const w5 = out.future[4].upper - out.future[4].lower;
        expect(w5).toBeGreaterThan(w1);
    });

    it('is deterministic', () => {
        const values = [2, 4, 3, 5, 4, 6];
        expect(forecast({ values, horizon: 3 })).toEqual(forecast({ values, horizon: 3 }));
    });

    it('filters out non-numeric values', () => {
        const out = forecast({ values: [1, null, 2, undefined, 3], horizon: 2 });
        expect(out.fitted.length).toBe(3);
    });
});