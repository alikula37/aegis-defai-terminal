import { describe, it, expect } from 'vitest';
import { safeFormatTime, safeFormatDateTime } from '../lib/timeFormat';

describe('safeFormatTime', () => {
    it('formats a valid timestamp', () => {
        const t = safeFormatTime(new Date('2026-08-15T12:34:56Z').getTime());
        expect(t).not.toBe('--:--:--');
    });

    it('returns --:--:-- for missing input', () => {
        expect(safeFormatTime(null)).toBe('--:--:--');
        expect(safeFormatTime(undefined)).toBe('--:--:--');
        expect(safeFormatTime('')).toBe('--:--:--');
    });

    it('returns --:--:-- for invalid input instead of Invalid Date', () => {
        expect(safeFormatTime('not-a-date')).toBe('--:--:--');
        expect(safeFormatTime(NaN)).toBe('--:--:--');
    });
});

describe('safeFormatDateTime', () => {
    it('returns — for invalid/missing input', () => {
        expect(safeFormatDateTime(null)).toBe('—');
        expect(safeFormatDateTime('garbage')).toBe('—');
    });
});
