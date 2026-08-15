import { useModalA11y } from '../hooks/useModalA11y';
import { useI18n } from '../i18n/I18nProvider';

// Support modal — informational: points the user at real contact channels.
// (Previously a fake form that "sent" the message nowhere; the fake send was
// removed in favor of honest guidance.)
export default function SupportModal({ isOpen, onClose }) {
    const { t } = useI18n();
    const { modalRef } = useModalA11y({ isOpen, onClose });

    if (!isOpen) return null;

    return (
        <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="support-modal-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-surface-container border border-outline-variant rounded-xl p-6 w-full max-w-md shadow-2xl relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface transition-colors"
                    aria-label="Close support dialog"
                >
                    <span className="material-symbols-outlined">close</span>
                </button>

                <h2 id="support-modal-title" className="font-[Inter] text-[20px] font-semibold text-on-surface mb-6 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">help</span>
                    {t('support.title')}
                </h2>

                <div className="space-y-4">
                    <p className="font-[JetBrains_Mono] text-[13px] leading-[20px] text-on-surface-variant">
                        {t('support.intro')}
                    </p>
                    <div className="bg-surface-variant border border-outline-variant rounded-lg p-4 space-y-3">
                        <a
                            href="https://github.com/anomalyco/opencode/issues"
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-3 text-on-surface hover:text-primary transition-colors"
                        >
                            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">bug_report</span>
                            <span className="font-[JetBrains_Mono] text-[13px]">{t('support.report')}</span>
                        </a>
                        <a
                            href="https://github.com/anomalyco/opencode"
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-3 text-on-surface hover:text-primary transition-colors"
                        >
                            <span className="material-symbols-outlined text-[18px] text-on-surface-variant">description</span>
                            <span className="font-[JetBrains_Mono] text-[13px]">{t('support.source')}</span>
                        </a>
                        <div className="flex items-center gap-3 text-on-surface-variant">
                            <span className="material-symbols-outlined text-[18px]">info</span>
                            <span className="font-[JetBrains_Mono] text-[12px] leading-[16px]">
                                {t('support.reportHint')}
                            </span>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-full py-2 rounded-md font-[JetBrains_Mono] text-[13px] font-medium transition-colors border border-outline-variant text-on-surface hover:bg-surface-container-highest"
                    >
                        {t('common.close')}
                    </button>
                </div>
            </div>
        </div>
    );
}
