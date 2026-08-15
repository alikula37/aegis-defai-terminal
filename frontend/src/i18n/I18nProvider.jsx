import { createContext, useContext, useState, useCallback, useMemo } from 'react';
import en from './messages.en.js';
import tr from './messages.tr.js';

// Lightweight i18n: flat-key dictionaries (en/tr), persisted language
// preference. Default is always English; the user switches via the EN|TR
// toggle. Backend (technical) error strings are intentionally not translated.

const MESSAGES = { en, tr };
const STORAGE_KEY = 'aegis.lang';

const I18nContext = createContext(null);

function initialLang() {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'en' || stored === 'tr') return stored;
    return 'en';
}

export function I18nProvider({ children }) {
    const [lang, setLangState] = useState(initialLang);

    const setLang = useCallback((next) => {
        if (next !== 'en' && next !== 'tr') return;
        localStorage.setItem(STORAGE_KEY, next);
        setLangState(next);
    }, []);

    // t('key', { var: value }) — falls back to English, then to the raw key.
    // String vars are interpolated inline; element vars (rich text like links)
    // are spliced in as React nodes so the result stays renderable.
    const t = useCallback((key, vars) => {
        const msg = MESSAGES[lang][key] ?? MESSAGES.en[key] ?? key;
        if (!vars) return msg;
        const hasNodes = Object.values(vars).some(v => typeof v !== 'string' && typeof v !== 'number');
        if (!hasNodes) {
            return String(msg).replace(/\{(\w+)\}/g, (m, name) =>
                vars[name] !== undefined ? String(vars[name]) : m,
            );
        }
        const parts = String(msg).split(/\{(\w+)\}/g);
        return parts.map((part, i) => {
            if (i % 2 === 1) return vars[part] !== undefined ? vars[part] : `{${part}}`;
            return part;
        });
    }, [lang]);

    const value = useMemo(() => ({ lang, setLang, t }), [lang, setLang, t]);

    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
    const ctx = useContext(I18nContext);
    if (!ctx) throw new Error('useI18n must be used within I18nProvider');
    return ctx;
}
