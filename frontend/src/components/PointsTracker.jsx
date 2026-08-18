import { useWebSocket } from '../contexts/WebSocketContext';
import { useI18n } from '../i18n/I18nProvider';

// Tailwind v4 only emits literal class names — keep a fixed lookup so the
// dynamic color classes are always generated. Must be declared before
// PointItem uses it (TDZ).
const POINT_COLORS = {
    violet: 'text-violet-400',
    blue: 'text-blue-400',
    cyan: 'text-cyan-400',
    green: 'text-success',
    amber: 'text-amber-400',
    yellow: 'text-amber-400',
    red: 'text-rose-400',
    rose: 'text-rose-400',
};

const PointItem = ({ icon, label, apy, color, description, negative = false }) => (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-surface-container-lowest border border-outline-variant hover:border-outline transition-all">
        <div className={`text-xl mt-0.5`}>{icon}</div>
        <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-on-surface truncate">{label}</span>
                {/* Tailwind v4 only emits literal class names — map the dynamic
                    color to a fixed lookup so text-violet-400 & co. are generated */}
                <span className={`text-sm font-mono font-bold flex-shrink-0 ${negative ? 'text-error' : POINT_COLORS[color] || 'text-on-surface-variant'}`}>
                    {negative ? '' : '+'}{typeof apy === 'number' ? apy.toFixed(2) : '—'}%
                </span>
            </div>
            <p className="text-xs text-on-surface-variant mt-0.5 leading-snug">{description}</p>
        </div>
    </div>
);

export default function PointsTracker() {
    const { t } = useI18n();
    const { portfolioData } = useWebSocket();
    const points = portfolioData?.points;

if (!points) {
        return (
            <div className="bg-surface-container border border-outline-variant rounded-xl p-5">
                <h3 className="text-sm font-semibold text-on-surface-variant mb-3 flex items-center gap-2">
                    <span>🎯</span> {t('points.titleFull')}
                </h3>
                <p className="text-xs text-on-surface-variant/60 text-center py-4">{t('crossChain.awaiting')}</p>
            </div>
        );
    }

    const totalBonus = points.totalPointsApy ?? 0;

    return (
        <div className="bg-surface-container border border-outline-variant rounded-xl p-5 space-y-4">
            {/* Header */}
            <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold text-on-surface flex items-center gap-2">
                    <span>🎯</span> {t('points.titleFull')}
                </h3>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-on-surface-variant">{t('points.totalBonus')}</span>
                    <span className={`text-sm font-mono font-bold ${totalBonus > 0 ? 'text-emerald-400' : 'text-error'}`}>
                        {totalBonus > 0 ? '+' : ''}{t('crossChain.apy', { apy: totalBonus.toFixed(2) })}
                    </span>
                </div>
            </div>

            {/* Explanation */}
            <p className="text-xs text-on-surface-variant leading-relaxed">
                {t('points.desc')}
            </p>

            {/* Point Items */}
            <div className="space-y-2">
                <PointItem
                    icon="🟣"
                    label={t('points.morphoTitle')}
                    apy={points.morphoPointsApy}
                    color="violet"
                    description={t('points.morphoDesc')}
                />
                <PointItem
                    icon="🔵"
                    label={t('points.ethenaTitle')}
                    apy={points.enaPointsApy}
                    color="blue"
                    description={t('points.ethenaDesc')}
                />
                <PointItem
                    icon="🟡"
                    label={t('points.borosTitle')}
                    apy={points.borosFundingYield}
                    color="yellow"
                    description={t('points.borosDesc')}
                />
                <PointItem
                    icon="🔴"
                    label={t('points.corkTitle')}
                    apy={points.corkHedgeCost}
                    color="red"
                    negative={true}
                    description={t('points.corkDesc')}
                />
            </div>

            {/* Net summary bar */}
            <div className="mt-2 pt-3 border-t border-outline-variant flex items-center justify-between text-xs">
                <span className="text-on-surface-variant">{t('points.realizedBonus')}</span>
                <span className="font-mono text-emerald-300 font-bold">
                    {t('points.effectiveApy', { bonus: Math.max(0, totalBonus * 0.5).toFixed(2) })}
                </span>
            </div>
        </div>
    );
}
