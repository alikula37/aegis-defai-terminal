import { useWebSocket } from '../contexts/WebSocketContext';

const PointItem = ({ icon, label, apy, color, description, negative = false }) => (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-white/5 border border-white/10 hover:border-white/20 transition-all">
        <div className={`text-xl mt-0.5`}>{icon}</div>
        <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold text-white/90 truncate">{label}</span>
                {/* Tailwind v4 only emits literal class names — map the dynamic
                    color to a fixed lookup so text-violet-400 & co. are generated */}
                <span className={`text-sm font-mono font-bold flex-shrink-0 ${negative ? 'text-red-400' : POINT_COLORS[color] || 'text-white/80'}`}>
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
    green: 'text-green-400',
    amber: 'text-amber-400',
    rose: 'text-rose-400',
};

export default function PointsTracker() {
    const { portfolioData } = useWebSocket();
    const points = portfolioData?.points;

    if (!points) {
        return (
            <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
                <h3 className="text-sm font-semibold text-white/60 mb-3 flex items-center gap-2">
                    <span>🎯</span> Points &amp; Airdrop Yield
                </h3>
                <p className="text-xs text-white/30 text-center py-4">Awaiting first oracle cycle…</p>
            </div>
        );
    }

    const totalBonus = points.totalPointsApy ?? 0;

    return (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
                    <span>🎯</span> Points &amp; Airdrop Yield
                </h3>
                <div className="flex items-center gap-2">
                    <span className="text-xs text-white/40">Total Bonus:</span>
                    <span className={`text-sm font-mono font-bold ${totalBonus > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {totalBonus > 0 ? '+' : ''}{totalBonus.toFixed(2)}% APY
                    </span>
                </div>
            </div>

            {/* Explanation */}
            <p className="text-xs text-white/40 leading-relaxed">
                Extra yield layer on top of base strategy APY. Points are not immediately liquid — estimated at 50% face-value realization.
            </p>

            {/* Point Items */}
            <div className="space-y-2">
                <PointItem
                    icon="🟣"
                    label="Morpho MOR Points"
                    apy={points.morphoPointsApy}
                    color="violet"
                    description="Earned on USDC borrow / supply positions. Distributed as MOR tokens on snapshot."
                />
                <PointItem
                    icon="🔵"
                    label="Ethena ENA Season 6"
                    apy={points.enaPointsApy}
                    color="blue"
                    description="40× multiplier via sENA lock. Applies to all sUSDe-adjacent positions. Ethereal & Derive airdrop eligible."
                />
                <PointItem
                    icon="🟡"
                    label="Boros YU Funding Yield"
                    apy={points.borosFundingYield}
                    color="yellow"
                    description="Funding rate tokenization via Pendle Boros. Positive when perpetual funding is bullish; earns Roots points."
                />
                <PointItem
                    icon="🔴"
                    label="Cork Depeg Hedge Cost"
                    apy={points.corkHedgeCost}
                    color="red"
                    negative={true}
                    description="Insurance cost for sUSDe:USDT depeg swap (Cork Protocol). Protects against flash-crash liquidations."
                />
            </div>

            {/* Net summary bar */}
            <div className="mt-2 pt-3 border-t border-white/10 flex items-center justify-between text-xs">
                <span className="text-white/40">Realized bonus (50% of face value)</span>
                <span className="font-mono text-emerald-300 font-bold">
                    +{Math.max(0, totalBonus * 0.5).toFixed(2)}% effective APY
                </span>
            </div>
        </div>
    );
}
