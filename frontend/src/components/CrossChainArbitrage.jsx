import { useWebSocket } from '../contexts/WebSocketContext';
import { useI18n } from '../i18n/I18nProvider';

const RateBar = ({ label, apy, maxApy = 10, color = 'bg-blue-500', badge = null }) => {
    const { t } = useI18n();
    const value = Number(apy);
    const safeApy = Number.isFinite(value) ? value : 0;
    const pct = Math.min(100, (safeApy / (Number(maxApy) || 10)) * 100);
    return (
        <div className="space-y-1">
            <div className="flex justify-between items-center">
                <span className="text-xs text-on-surface-variant">{label}</span>
                <div className="flex items-center gap-2">
                    {badge && (
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${badge === 'BEST' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'}`}>
                            {badge === 'BEST' ? t('crossChain.best') : badge}
                        </span>
                    )}
                    <span className="text-xs font-mono font-bold text-white">{safeApy.toFixed(2)}%</span>
                </div>
            </div>
            <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                <div className={`h-full ${color} rounded-full transition-all duration-700`} style={{ width: `${pct}%` }} />
            </div>
        </div>
    );
};

export default function CrossChainArbitrage() {
    const { t } = useI18n();
    const { portfolioData } = useWebSocket();
    const cc = portfolioData?.crossChain;
    const l1Borrow = portfolioData?.bestBorrowApy;

    if (!cc || l1Borrow == null) {
        return (
            <div className="bg-surface-container border border-outline-variant rounded-xl p-5">
                <h3 className="text-sm font-semibold text-on-surface-variant mb-3 flex items-center gap-2">
                    <span>🌉</span> {t('crossChain.title')}
                </h3>
                <p className="text-xs text-on-surface-variant/60 text-center py-4">{t('crossChain.awaiting')}</p>
            </div>
        );
    }

    const maxRate = Math.max(l1Borrow, cc.arbitrumBorrowApy || 0, cc.baseBorrowApy || 0) * 1.15;
    const bestIsArbitrum = (cc.arbitrumBorrowApy ?? Infinity) <= (cc.baseBorrowApy ?? Infinity);
    // Guards: partial WS payloads must never crash the page (undefined.toFixed).
    const savingsApy = Number(cc.crossChainSavings);
    const safeSavings = Number.isFinite(savingsApy) ? savingsApy : 0;
    const bridgeCost = Number(cc.bridgeCostUsd);
    const safeBridgeCost = Number.isFinite(bridgeCost) ? bridgeCost : 0;
    const bestChain = typeof cc.crossChainNetwork === 'string' ? cc.crossChainNetwork.split(' ')[0] : 'L1';

return (
        <div className="bg-surface-container border border-outline-variant rounded-xl p-5 space-y-4">
            {/* Header */}
            <div className="flex justify-between items-center">
                <h3 className="text-sm font-semibold text-on-surface flex items-center gap-2">
                    <span>🌉</span> {t('crossChain.title')}
                </h3>
                <span className={`text-xs px-2 py-1 rounded-full font-mono border ${cc.isCrossChainArbitrageAvailable ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-surface-container-lowest text-on-surface-variant border-outline-variant'}`}>
                    {cc.isCrossChainArbitrageAvailable ? t('crossChain.opportunity') : t('crossChain.holdL1')}
                </span>
            </div>

            {/* Description */}
            <p className="text-xs text-on-surface-variant leading-relaxed">
                {t('crossChain.desc')}
            </p>

            {/* Rate comparison bars */}
            <div className="space-y-3 pt-1">
                <RateBar
                    label={t('crossChain.l1Rate')}
                    apy={l1Borrow}
                    maxApy={maxRate}
                    color="bg-error"
                    badge={null}
                />
                <RateBar
                    label={t('crossChain.arbRate')}
                    apy={cc.arbitrumBorrowApy}
                    maxApy={maxRate}
                    color="bg-blue-500"
                    badge={bestIsArbitrum ? 'BEST' : null}
                />
                <RateBar
                    label={t('crossChain.baseRate')}
                    apy={cc.baseBorrowApy}
                    maxApy={maxRate}
                    color="bg-violet-500"
                    badge={!bestIsArbitrum ? 'BEST' : null}
                />
            </div>

            {/* Summary row */}
            <div className="pt-3 border-t border-outline-variant grid grid-cols-3 gap-3 text-center">
                <div>
                    <p className="text-[10px] text-on-surface-variant mb-1">{t('crossChain.annualSavings')}</p>
                    <p className={`text-sm font-mono font-bold ${safeSavings > 0 ? 'text-emerald-400' : 'text-on-surface-variant'}`}>
                        {safeSavings > 0 ? '+' : ''}{t('crossChain.apy', { apy: safeSavings.toFixed(2) })}
                    </p>
                </div>
                <div>
                    <p className="text-[10px] text-on-surface-variant mb-1">{t('crossChain.bridgeCost')}</p>
                    <p className="text-sm font-mono font-bold text-orange-400">~${safeBridgeCost.toFixed(0)}</p>
                </div>
                <div>
                    <p className="text-[10px] text-on-surface-variant mb-1">{t('crossChain.bestChain')}</p>
                    <p className="text-sm font-mono font-bold text-on-surface truncate text-xs">
                        {bestChain}
                    </p>
                </div>
            </div>

            {cc.isCrossChainArbitrageAvailable ? (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 text-xs text-emerald-300 leading-relaxed">
                    {t('crossChain.opportunityMsg')}
                </div>
            ) : (
                <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-3 text-xs text-on-surface-variant leading-relaxed">
                    {t('crossChain.holdMsg', { savings: safeSavings.toFixed(2) })}
                </div>
            )}
        </div>
    );
}
