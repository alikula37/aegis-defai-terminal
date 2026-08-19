// Locale-aware number formatting helpers. Central replacement for the
// hardcoded toLocaleString('en-US', …) calls scattered across components, so
// currency/percent rendering follows the browser/app locale instead of being
// pinned to US formatting.
//
// Each helper accepts an optional `locale` (e.g. the i18n lang) and falls back
// to the runtime default when omitted. All return strings; callers pass the
// result straight into JSX.

function resolveLocale(locale) {
    if (locale === 'tr') return 'tr-TR';
    if (locale === 'en') return 'en-US';
    return locale || undefined; // undefined → Intl default (browser locale)
}

/** USD amount, e.g. "$1,234.56" or "+$12.00". */
export function fmtUsd(value, { locale, fractionDigits = 2 } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    const sign = n < 0 ? '-' : '+';
    return `${sign}$${new Intl.NumberFormat(resolveLocale(locale), {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(abs)}`;
}

/** Plain USD magnitude (no forced sign), e.g. "$1,234.56". */
export function fmtUsdPlain(value, { locale, fractionDigits = 2 } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat(resolveLocale(locale), {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(n);
}

/** Percent with fixed decimals and optional sign, e.g. "+5.20%" or "12.00%". */
export function fmtPct(value, { locale, fractionDigits = 2, signed = false } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const num = new Intl.NumberFormat(resolveLocale(locale), {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(Math.abs(n));
    return `${signed ? (n < 0 ? '-' : '+') : ''}${num}%`;
}

/** General number with grouping, e.g. "12,345.6". */
export function fmtNumber(value, { locale, fractionDigits = 2 } = {}) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    return new Intl.NumberFormat(resolveLocale(locale), {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
    }).format(n);
}

/** Compact USD for axis ticks, e.g. "$1.2k". */
export function fmtUsdCompact(value, locale) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    const base = new Intl.NumberFormat(resolveLocale(locale), { maximumFractionDigits: 1 });
    if (abs >= 1e9) return `$${base.format(n / 1e9)}B`;
    if (abs >= 1e6) return `$${base.format(n / 1e6)}M`;
    if (abs >= 1e3) return `$${base.format(n / 1e3)}k`;
    return `$${base.format(n)}`;
}