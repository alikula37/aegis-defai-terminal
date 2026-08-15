import { useState } from 'react';
import StrategyDetailsModal from './StrategyDetailsModal';
import { useI18n } from '../i18n/I18nProvider';

export default function StrategyMarketplace({ strategies = [] }) {
    const { t } = useI18n();
    const [selectedStrategy, setSelectedStrategy] = useState(null);
    const getStrategyUI = (s) => {
        let icon = 'currency_exchange';
        let iconBg = 'bg-surface-variant border-outline-variant';
        let iconColor = 'text-on-surface-variant';

        if (s.name.includes('Pendle') && !s.name.includes('Boros')) {
            icon = 'currency_exchange';
            iconBg = 'bg-primary/10 border-primary/20';
            iconColor = 'text-primary';
        } else if (s.name.includes('Morpho')) {
            icon = 'autorenew';
            iconBg = 'bg-secondary/10 border-secondary/20';
            iconColor = 'text-secondary';
        } else if (s.name.includes('Ethena')) {
            icon = 'warning';
            iconBg = 'bg-tertiary/10 border-tertiary/20';
            iconColor = 'text-tertiary';
        } else if (s.name.includes('syrup') || s.name.includes('RWA')) {
            icon = 'account_balance';
            iconBg = 'bg-success/10 border-green-500/20';
            iconColor = 'text-success';
        } else if (s.name.includes('Boros')) {
            icon = 'swap_horiz';
            iconBg = 'bg-orange-500/10 border-orange-500/20';
            iconColor = 'text-orange-400';
        }

        let riskStyle = 'bg-success/10 text-success border-success/20';
        if (s.risk === 'Med') riskStyle = 'bg-warning/10 text-warning border-warning/20';
        if (s.risk === 'High') riskStyle = 'bg-error/10 text-error border-error/20';

        let statusStyle = 'bg-surface-variant border-outline-variant text-on-surface-variant';
        let dotColor = 'bg-outline';
        if (s.status === 'ACTIVE') {
            statusStyle = 'bg-success/10 border-success/20 text-success';
            dotColor = 'bg-success';
        }

        return { icon, iconBg, iconColor, riskStyle, statusStyle, dotColor };
    };

    return (
        <div className="bg-surface-container border border-outline-variant rounded-xl overflow-hidden">
            <div className="p-6 border-b border-outline-variant flex justify-between items-center">
                <h3 className="font-[Inter] text-[20px] leading-[28px] font-semibold text-on-surface">{t('market.positions')}</h3>
                <div className="flex gap-2">
                    <button className="px-3 py-1.5 border border-outline-variant rounded-md text-on-surface-variant hover:text-on-surface hover:bg-surface-variant transition-colors font-[JetBrains_Mono] text-[13px] flex items-center gap-1">
                        <span className="material-symbols-outlined text-[16px]">filter_list</span> {t('market.filter')}
                    </button>
                    <button className="px-3 py-1.5 bg-surface-variant border border-outline rounded-md text-on-surface transition-colors font-[JetBrains_Mono] text-[13px]">
                        {t('market.all')}
                    </button>
                </div>
            </div>
            <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="border-b border-outline-variant/50 bg-surface-container-low/50">
                            <th className="p-4 font-[JetBrains_Mono] text-[13px] text-on-surface-variant font-normal w-1/3">{t('market.strategyName')}</th>
                            <th className="p-4 font-[JetBrains_Mono] text-[13px] text-on-surface-variant font-normal">{t('market.protocol')}</th>
                            <th className="p-4 font-[JetBrains_Mono] text-[13px] text-on-surface-variant font-normal hidden lg:table-cell">{t('market.borrowVia')}</th>
                            <th className="p-4 font-[JetBrains_Mono] text-[13px] text-on-surface-variant font-normal">{t('details.riskLevel')}</th>
                            <th className="p-4 font-[JetBrains_Mono] text-[13px] text-on-surface-variant font-normal text-right">{t('details.currentApy')}</th>
                            <th className="p-4 font-[JetBrains_Mono] text-[13px] text-on-surface-variant font-normal text-center">{t('market.status')}</th>
                            <th className="p-4 font-[JetBrains_Mono] text-[13px] text-on-surface-variant font-normal text-right">{t('market.action')}</th>
                        </tr>
                    </thead>
                    <tbody className="text-[14px]">
                        {strategies.length === 0 ? (
                            <tr>
                                <td colSpan="6" className="p-8 text-center text-on-surface-variant font-[JetBrains_Mono] text-[13px]">
                                    {t('market.waiting')}
                                </td>
                            </tr>
                        ) : (
                            strategies.map((s, i) => {
                                const ui = getStrategyUI(s);
                                const apyNum = Number(s.apy);
                                const apy = Number.isFinite(apyNum) ? apyNum : 0;
                                const apyFormatted = `${apy > 0 ? '+' : ''}${apy.toFixed(2)}%`;
                                const apyColor = apy > 0 ? 'text-success' : 'text-error';

                                return (
                                    <tr
                                        key={i}
                                        className="border-b border-outline-variant/30 hover:bg-surface-variant/30 transition-colors"
                                    >
                                        <td className="p-4 font-medium text-on-surface flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded ${ui.iconBg} flex items-center justify-center border`}>
                                                <span className={`material-symbols-outlined ${ui.iconColor} text-[18px]`}>{ui.icon}</span>
                                            </div>
                                            {s.name}
                                        </td>
                                        <td className="p-4 text-on-surface-variant">{s.protocol}</td>
                                        <td className="p-4 text-on-surface-variant/60 font-[JetBrains_Mono] text-[11px] hidden lg:table-cell">
                                            {s.borrowProtocol || '—'}
                                        </td>
                                        <td className="p-4">
                                            <span className={`px-2 py-1 rounded ${ui.riskStyle} border font-[JetBrains_Mono] text-[12px]`}>{s.risk}</span>
                                        </td>
                                        <td className={`p-4 text-right ${apyColor} font-[JetBrains_Mono] text-[12px]`}>{apyFormatted}</td>
                                        <td className="p-4 text-center">
                                            <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${ui.statusStyle} border`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${ui.dotColor}`}></span>
                                                <span className="font-[JetBrains_Mono] text-[11px] uppercase tracking-wider">{s.status}</span>
                                            </div>
                                        </td>
                                        <td className="p-4 text-right">
                                            <button
                                                onClick={() => setSelectedStrategy(s)}
                                                className="text-primary hover:text-primary-fixed transition-colors font-[JetBrains_Mono] text-[13px] flex items-center justify-end gap-1 ml-auto"
                                            >
                                                <span className="material-symbols-outlined text-[16px]">insights</span>
                                                Insights
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })
                        )}
                    </tbody>
                </table>
            </div>
            <StrategyDetailsModal
                isOpen={!!selectedStrategy}
                onClose={() => setSelectedStrategy(null)}
                strategy={selectedStrategy}
            />
        </div>
    );
}
