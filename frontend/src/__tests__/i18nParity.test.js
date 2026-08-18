import { describe, it, expect } from 'vitest';
import en from '../i18n/messages.en.js';
import tr from '../i18n/messages.tr.js';

// The whole UI relies on t('key'); a missing TR key silently renders the raw
// key, so EN ⇄ TR must never drift. New keys must be added to both files.
describe('i18n key parity (EN ⇄ TR)', () => {
    it('has identical key sets in both languages', () => {
        const enKeys = Object.keys(en).sort();
        const trKeys = Object.keys(tr).sort();

        const onlyEn = enKeys.filter(k => !trKeys.includes(k));
        const onlyTr = trKeys.filter(k => !enKeys.includes(k));

        expect(onlyEn, 'keys missing in TR').toEqual([]);
        expect(onlyTr, 'keys missing in EN').toEqual([]);
        expect(trKeys.length).toBe(enKeys.length);
    });

    it('has no empty values in either language', () => {
        for (const [k, v] of Object.entries(en)) {
            expect(typeof v === 'string' && v.trim().length > 0, `en.${k} is empty`).toBe(true);
        }
        for (const [k, v] of Object.entries(tr)) {
            expect(typeof v === 'string' && v.trim().length > 0, `tr.${k} is empty`).toBe(true);
        }
    });
});