const ICONS = {
    error: 'error',
    success: 'check_circle',
    info: 'info',
};

const STYLES = {
    error: 'border-error/40 text-error',
    success: 'border-success/40 text-success',
    info: 'border-outline-variant text-primary',
};

export function Toasts({ toasts, onDismiss }) {
    if (!toasts || toasts.length === 0) return null;
    return (
        <div className="fixed bottom-4 right-4 z-[70] flex flex-col gap-2 w-[320px] max-w-[calc(100vw-2rem)]" aria-live="polite">
            {toasts.map(t => (
                <div
                    key={t.id}
                    className={`flex items-start gap-2.5 bg-surface-container border rounded-xl p-3 shadow-2xl ${STYLES[t.type] || STYLES.info}`}
                >
                    <span className="material-symbols-outlined text-[18px] mt-0.5 shrink-0">{ICONS[t.type] || 'info'}</span>
                    <p className="flex-1 font-[JetBrains_Mono] text-[12px] leading-[16px] text-on-surface">{t.message}</p>
                    <button
                        onClick={() => onDismiss(t.id)}
                        aria-label="Dismiss notification"
                        className="text-on-surface-variant hover:text-on-surface transition-colors shrink-0"
                    >
                        <span className="material-symbols-outlined text-[16px]">close</span>
                    </button>
                </div>
            ))}
        </div>
    );
}
