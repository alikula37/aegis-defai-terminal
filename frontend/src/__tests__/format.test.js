import { describe, it, expect } from 'vitest';
import { fmtUsd, fmtUsdPlain, fmtPct, fmtNumber, fmtUsdCompact } from '../lib/format';

describe('format helpers', () => {
    const en = { locale: 'en' };

    it('formats USD with an explicit sign and 2 decimals', () => {
        expect(fmtUsd(1234.5, en)).toBe('+$1,234.50');
        expect(fmtUsd(-12, en)).toBe('-$12.00');
        expect(fmtUsd(0, en)).toBe('+$0.00');
        expect(fmtUsd('bad')).toBe('—');
    });

    it('formats plain USD without a forced sign', () => {
        expect(fmtUsdPlain(-12, en)).toBe('-$12.00');
        expect(fmtUsdPlain(0, en)).toBe('$0.00');
    });

    it('formats percentages with optional sign and decimals', () => {
        expect(fmtPct(5.2, en)).toBe('5.20%');
        expect(fmtPct(5.2, { ...en, signed: true })).toBe('+5.20%');
        expect(fmtPct(-3.1, { ...en, signed: true })).toBe('-3.10%');
        expect(fmtPct(12.345, { ...en, fractionDigits: 0 })).toBe('12%');
        expect(fmtPct(NaN)).toBe('—');
    });

    it('formats numbers with grouping', () => {
        expect(fmtNumber(12345.6, en)).toBe('12,345.60');
        expect(fmtNumber(5, en)).toBe('5.00');
    });

    it('formats compact USD for axis ticks', () => {
        expect(fmtUsdCompact(1200, 'en')).toBe('$1.2k');
        expect(fmtUsdCompact(2500000, 'en')).toBe('$2.5M');
        expect(fmtUsdCompact(999, 'en')).toBe('$999');
    });

    it('respects the tr locale when passed', () => {
        // Turkish grouping uses dots (1.234,56).
        expect(fmtUsd(1234.5, { locale: 'tr' })).toBe('+$1.234,50');
        expect(fmtPct(-3.1, { locale: 'tr', signed: true })).toBe('-3,10%');
    });
});