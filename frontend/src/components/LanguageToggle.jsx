import { useI18n } from '../i18n/I18nProvider';

// Compact EN | TR language switch. The choice persists in localStorage.
export default function LanguageToggle({ compact = false }) {
    const { lang, setLang, t } = useI18n();
    return (
        <div
            className={`flex items-center rounded-lg border border-outline-variant/30 bg-surface-container-lowest overflow-hidden ${compact ? 'gap-0' : 'gap-0'}`}
            role="group"
            aria-label={t('lang.label')}
        >
            {(['en', 'tr']).map(code => (
                <button
                    key={code}
                    onClick={() => setLang(code)}
                    aria-pressed={lang === code}
                    className={`px-2 py-1 font-[JetBrains_Mono] text-[11px] font-bold transition-colors ${lang === code ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
                >
                    {t(`lang.${code}`)}
                </button>
            ))}
        </div>
    );
}
