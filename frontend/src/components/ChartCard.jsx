import GlossaryTooltip from './GlossaryTooltip';

// Shared card shell for analytics/chart panels: title + optional subtitle +
// optional glossary term + optional right-side badge/actions. Layout wraps on
// narrow viewports (flex-wrap) so long titles and badges never collide.
export default function ChartCard({
    title,
    subtitle = null,
    icon = 'monitoring',
    glossary = null,
    badge = null,
    children,
    className = '',
}) {
    return (
        <div className={`bg-surface-container border border-outline-variant rounded-xl p-6 flex flex-col gap-4 ${className}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="font-[Inter] text-[16px] font-semibold text-on-surface flex items-center gap-2 flex-wrap">
                        <span className="material-symbols-outlined text-primary text-[20px] shrink-0">{icon}</span>
                        <span className="min-w-0">{title}</span>
                        {glossary && <GlossaryTooltip term={glossary} />}
                    </h3>
                    {subtitle && (
                        <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant mt-1 leading-relaxed">
                            {subtitle}
                        </p>
                    )}
                </div>
                {badge && <div className="shrink-0">{badge}</div>}
            </div>
            {children}
        </div>
    );
}