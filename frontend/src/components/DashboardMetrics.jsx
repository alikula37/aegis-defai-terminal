import { apiFetch } from '../lib/apiClient';
import { useState, useEffect } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import TvlHistoryModal from './TvlHistoryModal';

// Formatting for a live metric value; keeps the render callback flat (S3776).
function formatMetric(metric, rawValue, targetHf) {
    const out = {
        displayValue: metric.defaultValue,
        valueColor: metric.valueColor,
        iconColor: metric.iconColor,
        badgeText: metric.badge.text,
    };
    if (rawValue === null || rawValue === undefined) return out;
    if (metric.key === 'tvl') {
        out.displayValue = `$${Number(rawValue).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else if (metric.key === 'netApy') {
        const numValue = Number(rawValue);
        if (numValue > 0) {
            out.displayValue = `+${numValue.toFixed(2)}%`;
            out.valueColor = 'text-success';
            out.iconColor = 'text-success/70';
        } else {
            out.displayValue = `${numValue.toFixed(2)}%`;
            out.valueColor = 'text-error';
            out.iconColor = 'text-error/70';
        }
    } else if (metric.key === 'healthFactor') {
        out.displayValue = Number(rawValue).toFixed(2);
        out.badgeText = `Target: >${targetHf}`;
    }
    return out;
}

const DEFAULT_METRICS = [
    {
        label: 'Total Value Locked',
        key: 'tvl',
        defaultValue: '$40,000.00',
        icon: 'account_balance',
        iconColor: 'text-primary/70',
        valueColor: 'text-paper',
        hoverBg: 'group-hover:bg-primary/5',
        badge: { text: 'Leveraged Position', style: 'bg-primary-container/20 text-primary border border-primary/20' },
        bar: null,
    },
    {
        label: 'Net APY',
        key: 'netApy',
        defaultValue: '+42.5%',
        icon: 'trending_up',
        iconColor: 'text-success/70',
        valueColor: 'text-success',
        hoverBg: 'group-hover:bg-success/5',
        badge: { text: 'Realized Yield', style: 'bg-surface-variant text-on-surface-variant' },
        bar: null,
    },
    {
        label: 'Health Factor',
        key: 'healthFactor',
        defaultValue: '1.35',
        icon: 'vital_signs',
        iconColor: 'text-warning/70',
        valueColor: 'text-warning',
        hoverBg: 'group-hover:bg-warning/5',
        badge: { text: 'Target: >1.25', style: 'bg-surface-variant text-on-surface-variant' },
        bar: true,
    },
];



export default function DashboardMetrics() {
    const { portfolioData: liveData } = useWebSocket();
    const [isApyModalOpen, setIsApyModalOpen] = useState(false);
    const [isTvlModalOpen, setIsTvlModalOpen] = useState(false);
    const [targetHf, setTargetHf] = useState('1.25');

    useEffect(() => {
        apiFetch('/api/settings')
            .then(res => res.json())
            .then(data => {
                if (data && data.targetHf) {
                    setTargetHf(data.targetHf);
                }
            })
            .catch(err => console.error("Failed to fetch settings:", err));
    }, []);

    return (
        <div className="flex flex-col gap-4">
            <div className="flex items-center gap-6 bg-surface-container border border-outline rounded-lg p-4">
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">lan</span>
                    <span className="font-[JetBrains_Mono] text-[14px] text-on-surface-variant">Active Chain:</span>
                    <span className="font-bold text-on-surface">{liveData?.activeChain || 'Ethereum'}</span>
                </div>
                <div className="w-px h-6 bg-outline-variant"></div>
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">account_balance</span>
                    <span className="font-[JetBrains_Mono] text-[14px] text-on-surface-variant">Active Protocol:</span>
                    <span className="font-bold text-on-surface">{liveData?.activeProtocol || 'Morpho Blue'}</span>
                </div>
                <div className="w-px h-6 bg-outline-variant"></div>
                <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">monitoring</span>
                    <span className="font-[JetBrains_Mono] text-[14px] text-on-surface-variant">Current Leverage:</span>
                    <span className="font-bold text-on-surface">{liveData?.leverage || 5}x</span>
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-[1rem]">
                {DEFAULT_METRICS.map((m) => {
                    const rawValue = liveData && liveData[m.key] != null ? liveData[m.key] : null;
                    const formatted = formatMetric(m, rawValue, targetHf);
                    const { displayValue, valueColor, iconColor, badgeText } = formatted;
                    const isApyCard = m.key === 'netApy';
                    const isTvlCard = m.key === 'tvl';

                    return (
                        <div
                            key={m.label}
                            onClick={() => {
                                if (isApyCard) setIsApyModalOpen(true);
                                if (isTvlCard) setIsTvlModalOpen(true);
                            }}
                            className={`bg-surface-container border border-outline rounded-lg p-5 relative overflow-hidden group ${isApyCard || isTvlCard ? 'cursor-pointer hover:border-primary/50' : ''}`}
                        >
                            <div className={`absolute inset-0 ${m.hoverBg} transition-colors duration-300 pointer-events-none`}></div>
                            <div className="flex justify-between items-start mb-4">
                                <h3 className="font-[JetBrains_Mono] text-[13px] leading-[16px] font-medium text-on-surface-variant uppercase tracking-wider">{m.label}</h3>
                                <span className={`material-symbols-outlined ${iconColor}`}>{m.icon}</span>
                            </div>

                            {m.bar ? (
                                <div className="flex items-baseline gap-2">
                                    <p className={`font-[Inter] text-[48px] leading-[56px] tracking-[-0.02em] font-bold ${valueColor}`}>{displayValue}</p>
                                    <div className="w-16 h-2 bg-surface-variant rounded-full overflow-hidden flex">
                                        <div className="h-full bg-error w-[20%]"></div>
                                        <div className="h-full bg-warning w-[60%]"></div>
                                        <div className="h-full bg-success w-[20%]"></div>
                                    </div>
                                </div>
                            ) : (
                                <p className={`font-[Inter] text-[48px] leading-[56px] tracking-[-0.02em] font-bold ${valueColor}`}>{displayValue}</p>
                            )}

                            <div className="mt-4 flex items-center gap-2">
                                <span className={`px-2 py-1 rounded font-[JetBrains_Mono] text-[12px] leading-[18px] ${m.badge.style}`}>{badgeText}</span>
                                {(isApyCard || isTvlCard) && <span className="material-symbols-outlined text-[14px] text-on-surface-variant ml-auto opacity-0 group-hover:opacity-100 transition-opacity">open_in_new</span>}
                            </div>
                        </div>
                    );
                })}

                {/* APY Breakdown Modal */}
                {isApyModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
                        <div className="bg-surface-container border border-outline-variant rounded-xl p-6 w-full max-w-md shadow-2xl relative">
                            <button
                                onClick={() => setIsApyModalOpen(false)}
                                className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface transition-colors"
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>

                            <h2 className="font-[Inter] text-[20px] font-[510] text-paper mb-6 flex items-center gap-2">
                                <span className="material-symbols-outlined text-primary">analytics</span>
                                Yield Breakdown (4x Looping)
                            </h2>

                            <div className="space-y-4 font-[JetBrains_Mono] text-[14px]">
                                <div className="flex justify-between items-center pb-3 border-b border-outline-variant/50">
                                    <span className="text-on-surface-variant">Base sUSDe Staking Yield</span>
                                    <span className="text-success">+{liveData?.susdeApy?.toFixed(2) || '15.50'}%</span>
                                </div>
                                <div className="flex justify-between items-center pb-3 border-b border-outline-variant/50">
                                    <span className="text-on-surface-variant">USDC Borrow Cost</span>
                                    <span className="text-error">-{liveData?.morphoBorrowApy?.toFixed(2) || '7.20'}%</span>
                                </div>
                                <div className="flex justify-between items-center pb-3 border-b border-outline-variant/50">
                                    <span className="text-on-surface-variant">Base Spread</span>
                                    <span className={liveData?.baseSpread > 0 ? 'text-success' : 'text-error'}>
                                        {liveData?.baseSpread > 0 ? '+' : ''}{liveData?.baseSpread?.toFixed(2) || '8.30'}%
                                    </span>
                                </div>
                                <div className="flex justify-between items-center pb-3 border-b border-outline-variant/50">
                                    <span className="text-on-surface-variant">Leverage Multiplier</span>
                                    <span className="text-primary">x{liveData?.leverage || 4}</span>
                                </div>
                                <div className="flex justify-between items-center pt-2">
                                    <span className="text-on-surface font-bold">Net APY</span>
                                    <span className={`font-bold text-[18px] ${liveData?.netApy > 0 ? 'text-success' : 'text-error'}`}>
                                        {liveData?.netApy > 0 ? '+' : ''}{liveData?.netApy?.toFixed(2) || '42.50'}%
                                    </span>
                                </div>
                            </div>

                            {liveData?.baseSpread < 0 && (
                                <div className="mt-6 bg-error-container/20 border border-error/30 rounded-lg p-4 flex items-start gap-3">
                                    <span className="material-symbols-outlined text-error mt-0.5">warning</span>
                                    <p className="text-error font-[Inter] text-[13px] leading-relaxed">
                                        <strong>Warning:</strong> Borrow cost exceeds yield (Yield Inversion). Agent is preparing to unwind leverage to prevent losses.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <TvlHistoryModal isOpen={isTvlModalOpen} onClose={() => setIsTvlModalOpen(false)} />
            </div>
        </div>
    );
}
