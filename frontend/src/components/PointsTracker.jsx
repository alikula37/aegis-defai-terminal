import { useWebSocket } from '../contexts/WebSocketContext';
import { useI18n } from '../i18n/I18nProvider';

const PointItem = ({ icon, label, apy, color, description, negative = false }) => (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-all">
        <div className={`text-xl mt-0.5`}>{icon}</div>
        <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white/90 truncate">{label}</span>
                {/* Tailwind v4 only emits literal class names — map the dynamic
                    color to a fixed lookup so text-violet-400 & co. are generated */}
                <span className={`text-sm font-mono font-bold flex-shrink-0 ${negative ? 'text-error' : POINT_COLORS[color] || 'text-white/80'}`}>
                    {negative ? '' : '+'}{typeof apy === 'number' ? apy.toFixed(2) : '—'}%
                </span>
            </div>
            <p className="text-xs text-white/40 mt-0.5 leading-snug">{description}</p>
        </div>
    </div>
);

const POINT_COLORS = {
    violet: 'text-violet-400',
    blue: 'text-blue-400',
    cyan: 'text-cyan-400',
    green: 'text-success',
    amber: 'text-warning',
    rose: 'text-rose-400',
};

export default function PointsTracker() {
    const { t } = useI18n();
    const { portfolioData } = useWebSocket();
    const points = portfolioData?.points;

    if (!points) {
        return (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h3 className="text-sm font-semibold text-white/60 mb-3 flex items-center gap-2">
                    <span>🎯</span> {t('points.titleFull')}
                </h3>
                <p className="text-xs text-white/30 text-center py-4">{t('crossChain.awaiting')}</p>
            </div>
        );
    }

    const totalBonus = points.totalPointsApy ?? 0;

    return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
                    <span>🎯</span> {t('points.titleFull')}
                </h3>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-white/40">{t('points.totalBonus')}</span>
                    <span className={`text-sm font-mono font-bold ${totalBonus > 0 ? 'text-emerald-400' : 'text-error'}`}>
                        {totalBonus > 0 ? '+' : ''}{t('crossChain.apy', { apy: totalBonus.toFixed(2) })}
                    </span>
                </div>
            </div>

            {/* Explanation */}
            <p className="text-xs text-white/40 leading-relaxed">
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
            <div className="mt-2 pt-3 border-t border-white/10 flex items-center justify-between text-xs">
                <span className="text-white/40">{t('points.realizedBonus')}</span>
                <span className="font-mono text-emerald-300 font-bold">
                    {t('points.effectiveApy', { bonus: Math.max(0, totalBonus * 0.5).toFixed(2) })}
                </span>
            </div>
        </div>
    );
}
