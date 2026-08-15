import { useModalA11y } from '../hooks/useModalA11y';
import { useI18n } from '../i18n/I18nProvider';

export default function DocsModal({ isOpen, onClose }) {
    const { modalRef } = useModalA11y({ isOpen, onClose });
    const { t } = useI18n();
    if (!isOpen) return null;

    return (
        <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="docs-modal-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-surface-container border border-outline-variant rounded-xl p-6 w-full max-w-2xl shadow-2xl relative max-h-[80vh] flex flex-col">
                <button
                    onClick={onClose}
                    aria-label={t('common.close')}
                    className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface transition-colors"
                >
                    <span className="material-symbols-outlined">close</span>
                </button>

                <h2 id="docs-modal-title" className="font-[Inter] text-[20px] font-semibold text-on-surface mb-6 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">description</span>
                    {t('docs.title')}
                </h2>

                <div className="overflow-y-auto pr-2 space-y-6 text-on-surface-variant text-sm font-[Inter]">
                    <section>
                        <h3 className="text-on-surface font-semibold text-base mb-2">{t('docs.terminalName')}</h3>
                        <p className="mb-2">
                            {t('docs.introReal')}
                        </p>
                    </section>

                    <section>
                        <h3 className="text-on-surface font-semibold text-base mb-2">{t('docs.changelog')}</h3>
                        <ul className="list-disc pl-5 space-y-2">
                            <li><strong>v1.2.0:</strong> {t('docs.v120')}</li>
                            <li><strong>v1.1.0:</strong> {t('docs.v110')}</li>
                            <li><strong>v1.0.5:</strong> {t('docs.v105')}</li>
                            <li><strong>v1.0.0:</strong> {t('docs.v100')}</li>
                        </ul>
                    </section>

                    <section>
                        <h3 className="text-on-surface font-semibold text-base mb-2">{t('docs.architecture')}</h3>
                        <p className="mb-2">
                            {t('docs.archBody')}
                        </p>
                        <p>
                            {t('docs.archModels')}
                        </p>
                    </section>
                </div>
            </div>
        </div>
    );
}
