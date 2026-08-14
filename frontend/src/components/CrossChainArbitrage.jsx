import { useWebSocket } from '../contexts/WebSocketContext';

const RateBar = ({ label, apy, maxApy = 10, color = 'bg-blue-500', badge = null }) => {
    const value = Number(apy);
    const safeApy = Number.isFinite(value) ? value : 0;
    const pct = Math.min(100, (safeApy / (Number(maxApy) || 10)) * 100);
    return (
        <div className="space-y-1">
            <div className="flex justify-between items-center">
                <span className="text-xs text-white/60">{label}</span>
                <div className="flex items-center gap-2">
                    {badge && (
                        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${badge === 'BEST' ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'}`}>
                            {badge}
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
    const { portfolioData } = useWebSocket();
    const cc = portfolioData?.crossChain;
    const l1Borrow = portfolioData?.bestBorrowApy;

    if (!cc || l1Borrow == null) {
        return (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h3 className="text-sm font-semibold text-white/60 mb-3 flex items-center gap-2">
                    <span>🌉</span> Cross-Chain Borrow Arbitrage
                </h3>
                <p className="text-xs text-white/30 text-center py-4">Awaiting first oracle cycle…</p>
            </div>
        );
    }

    const maxRate = Math.max(l1Borrow, cc.arbitrumBorrowApy || 0, cc.baseBorrowApy || 0) * 1.15;
    const bestIsArbitrum = (cc.arbitrumBorrowApy ?? Infinity) <= (cc.baseBorrowApy ?? Infinity);

    return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
                    <span>🌉</span> Cross-Chain Borrow Arbitrage
                </h3>
                <span className={`text-xs px-2 py-1 rounded-full font-mono border ${cc.isCrossChainArbitrageAvailable ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-white/5 text-white/40 border-white/10'}`}>
                    {cc.isCrossChainArbitrageAvailable ? '🟢 OPPORTUNITY' : '⚪ HOLD L1'}
                </span>
            </div>

            {/* Description */}
            <p className="text-xs text-white/40 leading-relaxed">
                Arbitrum and Base maintain structurally lower USDC borrow rates vs Ethereum L1 due to lower utilization.
                The borrow leg of our position can be migrated via <strong className="text-white/60">Chainlink CCIP</strong> to reduce cost.
            </p>

            {/* Rate comparison bars */}
            <div className="space-y-3 pt-1">
                <RateBar
                    label="Ethereum L1 (best of Morpho / Aave V4)"
                    apy={l1Borrow}
                    maxApy={maxRate}
                    color="bg-red-500"
                    badge={null}
                />
                <RateBar
                    label="Arbitrum — Aave V3"
                    apy={cc.arbitrumBorrowApy}
                    maxApy={maxRate}
                    color="bg-blue-500"
                    badge={bestIsArbitrum ? 'BEST' : null}
                />
                <RateBar
                    label="Base — Aave V3"
                    apy={cc.baseBorrowApy}
                    maxApy={maxRate}
                    color="bg-violet-500"
                    badge={!bestIsArbitrum ? 'BEST' : null}
                />
            </div>

            {/* Summary row */}
            <div className="pt-3 border-t border-white/10 grid grid-cols-3 gap-3 text-center">
                <div>
                    <p className="text-[10px] text-white/40 mb-1">Annual Savings</p>
                    <p className={`text-sm font-mono font-bold ${cc.crossChainSavings > 0 ? 'text-emerald-400' : 'text-white/50'}`}>
                        {cc.crossChainSavings > 0 ? '+' : ''}{cc.crossChainSavings.toFixed(2)}% APY
                    </p>
                </div>
                <div>
                    <p className="text-[10px] text-white/40 mb-1">Bridge Cost</p>
                    <p className="text-sm font-mono font-bold text-orange-400">~${cc.bridgeCostUsd.toFixed(0)}</p>
                </div>
                <div>
                    <p className="text-[10px] text-white/40 mb-1">Best Chain</p>
                    <p className="text-sm font-mono font-bold text-white/80 truncate text-xs">
                        {cc.crossChainNetwork.split(' ')[0]}
                    </p>
                </div>
            </div>

            {cc.isCrossChainArbitrageAvailable ? (
                <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-3 text-xs text-emerald-300 leading-relaxed">
                    💡 Agent may trigger <code className="font-mono bg-emerald-500/10 px-1 rounded">cross_chain_migrate</code> if savings exceed bridge cost.
                    Migration routed via <strong>Chainlink CCIP</strong> with Multicall3 batching.
                </div>
            ) : (
                <div className="bg-white/5 border border-white/10 rounded-xl p-3 text-xs text-white/40 leading-relaxed">
                    ℹ️ Cross-chain savings ({cc.crossChainSavings.toFixed(2)}% APY) below threshold or bridge costs exceed benefit. Staying on L1.
                </div>
            )}
        </div>
    );
}
