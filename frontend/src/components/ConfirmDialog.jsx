// Themed replacement for window.confirm(): a styled danger confirmation
// dialog using the app's tokens, with Escape/close via useModalA11y and the
// bulletproof overlay-scroll pattern (content is never cut off on short
// viewports).
import { useModalA11y } from '../hooks/useModalA11y';
import { useI18n } from '../i18n/I18nProvider';

export default function ConfirmDialog({
    isOpen,
    title,
    message,
    confirmLabel,
    cancelLabel,
    danger = true,
    onConfirm,
    onCancel,
}) {
    const { t } = useI18n();
    const { modalRef } = useModalA11y({ isOpen, onClose: onCancel });
    const resolvedTitle = title ?? t('confirm.title');
    const resolvedConfirmLabel = confirmLabel ?? t('common.confirm');
    const resolvedCancelLabel = cancelLabel ?? t('common.cancel');

    if (!isOpen) return null;

    return (
        <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title" className="fixed inset-0 z-[65] overflow-y-auto overscroll-contain bg-black/50">
            <div className="flex min-h-full items-center justify-center p-4">
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6 w-full max-w-sm shadow-2xl relative">
                    <div className="flex items-start gap-3 mb-4">
                        <span className={`material-symbols-outlined text-[22px] mt-0.5 ${danger ? 'text-error' : 'text-primary'}`}>
                            {danger ? 'warning' : 'help'}
                        </span>
                        <h2 id="confirm-dialog-title" className="font-[Inter] text-[16px] font-semibold text-on-surface">
                            {resolvedTitle}
                        </h2>
                    </div>
                    {message && (
                        <p className="font-[JetBrains_Mono] text-[12px] leading-[18px] text-on-surface-variant mb-6">
                            {message}
                        </p>
                    )}
                    <div className="flex gap-3 justify-end">
                        <button
                            onClick={onCancel}
                            className="px-4 py-2 rounded-md font-[JetBrains_Mono] text-[13px] font-medium border border-outline-variant text-on-surface hover:bg-surface-container-highest transition-colors"
                        >
                            {resolvedCancelLabel}
                        </button>
                        <button
                            onClick={onConfirm}
                            className={`px-4 py-2 rounded-md font-[JetBrains_Mono] text-[13px] font-medium transition-colors ${danger
                                ? 'bg-error text-on-error hover:bg-error-container hover:text-on-error-container'
                                : 'bg-primary text-on-primary hover:bg-primary-fixed hover:text-on-primary-fixed'}`}
                        >
                            {resolvedConfirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
