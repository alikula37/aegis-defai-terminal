import { useState, useRef, useEffect } from 'react';
import { useI18n } from '../i18n/I18nProvider';

/**
 * Compact inline glossary "?" popover. Explains a DeFi concept (Health Factor,
 * APY, TVL, delta-neutral, ...) to an end user without leaving the page.
 *
 * Props:
 *  - term:  i18n base key, e.g. 'glossary.hf'. Rendered strings are
 *           `t(term + '.title')` and `t(term + '.desc')`.
 *  - className: extra classes on the wrapping span.
 */
export default function GlossaryTooltip({ term, className = '' }) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const ref = useRef(null);

    useEffect(() => {
        if (!open) return;
        const onDocClick = (e) => {
            if (ref.current && !ref.current.contains(e.target)) setOpen(false);
        };
        const onKey = (e) => {
            if (e.key === 'Escape') setOpen(false);
        };
        document.addEventListener('mousedown', onDocClick);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocClick);
            document.removeEventListener('keydown', onKey);
        };
    }, [open]);

    const title = t(`${term}.title`);
    const desc = t(`${term}.desc`);

    return (
        <span ref={ref} className={`relative inline-flex items-center ${className}`}>
            <button
                type="button"
                aria-expanded={open}
                aria-haspopup="true"
                aria-label={`${title}: ${desc}`}
                onClick={() => setOpen(o => !o)}
                className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-surface-container-lowest border border-outline-variant text-on-surface-variant hover:text-primary hover:border-primary transition-colors cursor-help"
            >
                <span className="material-symbols-outlined text-[12px] leading-none">help</span>
            </button>
            {open && (
                <div
                    role="tooltip"
                    className="absolute z-50 top-full left-1/2 -translate-x-1/2 mt-2 w-72 max-w-[calc(100vw-2rem)] bg-surface-container-high border border-outline-variant rounded-xl p-4 shadow-2xl text-left"
                >
                    <p className="font-[Inter] text-[13px] font-semibold text-on-surface mb-1.5">{title}</p>
                    <p className="font-[JetBrains_Mono] text-[11px] leading-relaxed text-on-surface-variant">{desc}</p>
                </div>
            )}
        </span>
    );
}