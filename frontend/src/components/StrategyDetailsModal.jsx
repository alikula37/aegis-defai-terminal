import React from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import { deriveStrategyBreakdown, deriveAgentTimeline } from './strategyDetailsLogic';

export default function StrategyDetailsModal({ isOpen, onClose, strategy }) {
    const { portfolioData, agentLogs } = useWebSocket();

    if (!isOpen || !strategy) return null;

    const tvl = strategy.tvl || portfolioData?.tvl || 0;
    const { baseYield, borrowApy, pointsApy, netApy } = deriveStrategyBreakdown(strategy, portfolioData);
    const timeline = deriveAgentTimeline(agentLogs);

    const formatPct = v => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
    const formatTime = ts => {
        try {
            return new Date(ts).toLocaleTimeString();
        } catch {
            return '';
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 sm:p-6">
            <div className="absolute inset-0 bg-background/80 backdrop-blur-sm" onClick={onClose}></div>

            <div className="relative w-full max-w-2xl bg-surface-container-high border border-outline-variant rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
                {/* Header */}
                <div className="p-6 border-b border-outline-variant flex justify-between items-center bg-surface-container-highest">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center border border-primary/20">
                            <span className="material-symbols-outlined text-on-primary-container">analytics</span>
                        </div>
                        <div>
                            <h2 className="font-[Inter] text-[20px] leading-[28px] font-bold text-on-surface">{strategy.name}</h2>
                            <p className="font-[JetBrains_Mono] text-[13px] text-on-surface-variant flex items-center gap-2">
                                <span>{strategy.protocol}</span>
                                {strategy.borrowProtocol && (
                                    <>
                                        <span className="w-1 h-1 rounded-full bg-outline-variant"></span>
                                        <span>Borrow: {strategy.borrowProtocol}</span>
                                    </>
                                )}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant hover:bg-surface-variant hover:text-on-surface transition-colors"
                    >
                        <span className="material-symbols-outlined text-[20px]">close</span>
                    </button>
                </div>

                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 space-y-6">

                    {/* Key Metrics */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="p-4 rounded-xl bg-surface-container border border-outline-variant">
                            <p className="font-[Inter] text-[13px] text-on-surface-variant mb-1">Allocated Capital (TVL)</p>
                            <p className="font-[JetBrains_Mono] text-[24px] font-bold text-on-surface">
                                ${Number(tvl).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </p>
                        </div>
                        <div className="p-4 rounded-xl bg-surface-container border border-outline-variant">
                            <p className="font-[Inter] text-[13px] text-on-surface-variant mb-1">Net APY (live)</p>
                            <p className={`font-[JetBrains_Mono] text-[24px] font-bold ${netApy >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {formatPct(netApy)}
                            </p>
                        </div>
                    </div>

                    {/* APY Breakdown */}
                    <div>
                        <h3 className="font-[Inter] text-[16px] font-semibold text-on-surface mb-3 flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px] text-primary">pie_chart</span>
                            Yield Breakdown
                            {portfolioData?.oracleStatus && (
                                <span className="ml-auto font-[JetBrains_Mono] text-[11px] font-normal text-on-surface-variant border border-outline-variant rounded px-2 py-0.5">
                                    {portfolioData.oracleStatus}
                                </span>
                            )}
                        </h3>
                        <div className="p-4 rounded-xl bg-surface-container border border-outline-variant space-y-3">
                            <div className="flex justify-between items-center">
                                <span className="font-[Inter] text-[14px] text-on-surface-variant">Base Yield</span>
                                <span className="font-[JetBrains_Mono] text-[14px] text-green-400">{formatPct(baseYield)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="font-[Inter] text-[14px] text-on-surface-variant">Points / Airdrop Est.</span>
                                <span className="font-[JetBrains_Mono] text-[14px] text-green-400">{formatPct(pointsApy)}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="font-[Inter] text-[14px] text-on-surface-variant">Borrow Cost</span>
                                <span className="font-[JetBrains_Mono] text-[14px] text-red-400">{formatPct(-borrowApy)}</span>
                            </div>
                            <div className="pt-3 border-t border-outline-variant flex justify-between items-center">
                                <span className="font-[Inter] text-[14px] font-semibold text-on-surface">Net APY</span>
                                <span className={`font-[JetBrains_Mono] text-[16px] font-bold ${netApy >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                                    {formatPct(netApy)}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Recent Agent Actions */}
                    <div>
                        <h3 className="font-[Inter] text-[16px] font-semibold text-on-surface mb-3 flex items-center gap-2">
                            <span className="material-symbols-outlined text-[18px] text-primary">history</span>
                            Recent Agent Actions
                        </h3>
                        <div className="p-4 rounded-xl bg-surface-container border border-outline-variant">
                            {timeline.length === 0 ? (
                                <p className="text-[13px] text-on-surface-variant font-[JetBrains_Mono]">
                                    No agent activity recorded yet. Start a simulation to populate live events.
                                </p>
                            ) : (
                                <div className="space-y-4">
                                    {timeline.map((log, i) => (
                                        <div key={`${log.timestamp}-${i}`} className="relative flex items-start gap-3">
                                            <span className={`material-symbols-outlined text-[18px] mt-0.5 ${log.iconColor}`}>
                                                {log.icon}
                                            </span>
                                            <div className="min-w-0">
                                                <div className="flex items-center justify-between gap-3 mb-0.5">
                                                    <span className="font-bold text-on-surface text-[13px]">{log.title}</span>
                                                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant shrink-0">
                                                        {formatTime(log.timestamp)}
                                                    </span>
                                                </div>
                                                <p className="text-[12px] text-on-surface-variant break-words">{log.message}</p>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
}
