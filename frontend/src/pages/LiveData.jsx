import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useSettings } from '../contexts/SettingsContext';
import { safeFormatTime } from '../lib/timeFormat';
import { Link } from 'react-router-dom';

// --- Sub-components ---

const DataBadge = ({ label, value, unit = '', color = 'text-on-surface', icon = null, sub = null }) => (
    <div className="flex items-center justify-between py-3 border-b border-outline-variant/30 last:border-0">
        <div className="flex items-center gap-2">
            {icon && <span className="material-symbols-outlined text-[16px] text-on-surface-variant">{icon}</span>}
            <span className="font-[Inter] text-[14px] text-on-surface-variant">{label}</span>
        </div>
        <div className="text-right">
            <span className={`font-[JetBrains_Mono] text-[15px] font-bold ${color}`}>
                {value}{unit}
            </span>
            {sub && <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">{sub}</p>}
        </div>
    </div>
);

const DataCard = ({ title, icon, children, badge = null, badgeColor = 'text-primary' }) => (
    <div className="bg-surface-container border border-outline-variant rounded-xl p-5 flex flex-col gap-1">
        <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-[20px]">{icon}</span>
                <h3 className="font-[Inter] text-[15px] font-semibold text-on-surface">{title}</h3>
            </div>
            {badge && (
                <span className={`font-[JetBrains_Mono] text-[11px] font-bold ${badgeColor} bg-surface-container-lowest px-2 py-1 rounded-full border border-outline-variant/50`}>
                    {badge}
                </span>
            )}
        </div>
        {children}
    </div>
);

const LiveLogEntry = ({ log }) => {
    const colors = {
        scan: 'text-primary',
        alert: 'text-error',
        flash_loan: 'text-tertiary',
        rebalance: 'text-warning',
        claim: 'text-success',
        system: 'text-on-surface-variant',
    };
    const icons = {
        scan: 'radar',
        alert: 'warning',
        flash_loan: 'bolt',
        rebalance: 'swap_horiz',
        claim: 'savings',
        system: 'info',
    };
    const color = colors[log.type] || 'text-on-surface-variant';
    const icon = icons[log.type] || 'circle';

    return (
        <div className="flex items-start gap-3 py-2.5 border-b border-outline-variant/20 last:border-0 animate-[fadeIn_0.3s_ease]">
            <span className={`material-symbols-outlined text-[16px] mt-0.5 ${color} shrink-0`}>{icon}</span>
            <div className="flex-1 min-w-0">
                <p className={`font-[JetBrains_Mono] text-[12px] leading-[18px] ${color}`}>{log.message}</p>
            </div>
            <span className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant shrink-0 mt-0.5">
                {safeFormatTime(log.timestamp)}
            </span>
        </div>
    );
};

// --- Main Page ---
export default function LiveData() {
    const { isConnected, portfolioData, agentLogs: logs } = useWebSocket();
    const { isReady, isLoading } = useSettings();
    const [lastUpdated, setLastUpdated] = useState(null);
    const logContainerRef = useRef(null);
    const [status, setStatus] = useState('LIVE');

    useEffect(() => {
        if (!isConnected) {
            setStatus('OFFLINE');
        } else if (portfolioData?.oracleStatus) {
            setStatus(portfolioData.oracleStatus);
        } else {
            setStatus('LIVE');
        }
    }, [isConnected, portfolioData]);

    const getStatusColor = () => {
        if (status === 'LIVE') return 'bg-success';
        if (status === 'DEGRADED') return 'bg-warning';
        if (status === 'API LIMIT') return 'bg-error';
        return 'bg-outline';
    };

    const getStatusTextColor = () => {
        if (status === 'LIVE') return 'text-success';
        if (status === 'DEGRADED') return 'text-warning';
        if (status === 'API LIMIT') return 'text-error';
        return 'text-on-surface-variant';
    };

    useEffect(() => {
        if (portfolioData) {
            setLastUpdated(new Date());
        }
    }, [portfolioData]);

    // Auto-scroll logs to bottom on new entry
    useEffect(() => {
        if (logContainerRef.current) {
            logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
        }
    }, [logs]);

    const hf = portfolioData?.healthFactor ?? portfolioData?.health_factor;
    // Only color-code when there is a real value — a missing HF must never
    // render a fake "CRITICAL — de-leverage now" alarm.
    const hfColor = hf == null ? 'text-on-surface-variant' : hf >= 1.25 ? 'text-success' : hf >= 1.21 ? 'text-warning' : 'text-error';

    return (
        <div className="flex-1 overflow-y-auto p-[2rem] bg-background">
            {/* Readiness Banner */}
            {!isLoading && !isReady && (
                <div className="mb-6 bg-error-container/20 border border-error/50 rounded-xl p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-error text-[24px]">warning</span>
                        <div>
                            <h3 className="font-[Inter] text-[15px] font-semibold text-on-surface">System Not Configured</h3>
                            <p className="text-[13px] text-on-surface-variant mt-0.5">RPC URL and OpenRouter API Key are required to fetch live data and run the agent.</p>
                        </div>
                    </div>
                    <Link to="/settings" className="bg-error text-on-error px-4 py-2 rounded-lg font-[Inter] text-[13px] font-medium hover:brightness-110 transition-all">
                        Configure Settings
                    </Link>
                </div>
            )}

            {/* Header */}
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="font-[Inter] text-[24px] font-semibold text-on-surface">Live Oracle Feed</h2>
                    <p className="text-[14px] text-on-surface-variant mt-1">Real-time data from DeFiLlama, Morph, and Pendle oracles</p>
                </div>
                <div className="flex items-center gap-2 bg-surface-container border border-outline-variant px-4 py-2 rounded-full">
                    <span className={`w-2 h-2 rounded-full ${getStatusColor()} animate-pulse`}></span>
                    <span className={`font-[JetBrains_Mono] text-[12px] font-bold ${getStatusTextColor()}`}>{status}</span>
                    {lastUpdated && (
                        <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant ml-1">
                            · {lastUpdated.toLocaleTimeString('en-US', { hour12: false })}
                        </span>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">

                {/* 1. Price Oracle (DeFiLlama) */}
                <DataCard title="Price Oracle" icon="currency_exchange" badge="DeFiLlama" badgeColor="text-tertiary">
                    <DataBadge
                        label="Ethereum (ETH)"
                        value={portfolioData?.ethPrice ? `$${Number(portfolioData.ethPrice).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}
                        color="text-on-surface"
                        icon="currency_bitcoin"
                        sub="Real-time spot price"
                    />
                    <DataBadge
                        label="USD Coin (USDC)"
                        value={portfolioData?.usdcPrice ? `$${Number(portfolioData.usdcPrice).toFixed(4)}` : '—'}
                        color="text-success"
                        icon="paid"
                        sub="Stablecoin peg"
                    />
                    <DataBadge
                        label="sUSDe Price"
                        value={portfolioData?.susdePrice ? `$${Number(portfolioData.susdePrice).toFixed(4)}` : '—'}
                        color={portfolioData?.susdePrice ? 'text-success' : 'text-on-surface-variant'}
                        icon="token"
                        sub="Ethena synthetic dollar"
                    />
                </DataCard>

                {/* 2. Yield Oracle (DeFiLlama Yields) */}
                <DataCard title="Yield Oracle" icon="trending_up" badge="DeFiLlama Yields" badgeColor="text-success">
                    <DataBadge
                        label="sUSDe Base APY"
                        value={portfolioData?.susdeApy ? `${Number(portfolioData.susdeApy).toFixed(2)}%` : '—'}
                        color="text-primary"
                        icon="percent"
                        sub="Ethena staking yield"
                    />
                    <DataBadge
                        label="Pendle PT-sUSDe (Fixed)"
                        value={portfolioData?.pendlePtSusdeApy ? `${Number(portfolioData.pendlePtSusdeApy).toFixed(2)}%` : '—'}
                        color="text-tertiary"
                        icon="lock_clock"
                        sub="Fixed rate premium"
                    />
                    <DataBadge
                        label="Morpho USDC Borrow"
                        value={portfolioData?.morphoBorrowApy ? `${Number(portfolioData.morphoBorrowApy).toFixed(2)}%` : '—'}
                        color="text-warning"
                        icon="account_balance"
                        sub="Borrow cost on Morpho Blue"
                    />
                </DataCard>

                {/* 3. Strategy Metrics */}
                <DataCard title="Strategy Metrics" icon="analytics" badge="Computed" badgeColor="text-warning">
                    <DataBadge
                        label="Yield Spread"
                        value={portfolioData?.baseSpread !== undefined ? `${Number(portfolioData.baseSpread).toFixed(2)}%` : '—'}
                        color={portfolioData?.baseSpread >= 0 ? 'text-success' : 'text-error'}
                        icon="swap_vert"
                        sub="PT-sUSDe APY − Borrow Cost"
                    />
                    <DataBadge
                        label="Leverage Applied"
                        value={portfolioData?.leverage ? `${portfolioData.leverage}x` : '—'}
                        color="text-primary"
                        icon="stacked_line_chart"
                        sub="Morpho 91.5% LLTV loop"
                    />
                    <DataBadge
                        label="Net APY"
                        value={portfolioData?.netApy ? `${Number(portfolioData.netApy).toFixed(2)}%` : '—'}
                        color="text-success"
                        icon="auto_graph"
                        sub="After borrowing costs"
                    />
                </DataCard>

                {/* 4. Portfolio Health */}
                <DataCard title="Portfolio Health" icon="shield" badge="Risk Monitor" badgeColor="text-error">
                    <DataBadge
                        label="Health Factor"
                        value={hf != null ? Number(hf).toFixed(2) : '—'}
                        color={hfColor}
                        icon="monitor_heart"
                        sub={hf == null ? 'Waiting for oracle data' : hf >= 1.25 ? 'Safe — above target' : hf >= 1.21 ? 'Warning — rebalance soon' : 'CRITICAL — de-leverage now'}
                    />
                    <DataBadge
                        label="Total Value Locked"
                        value={portfolioData?.tvl ? `$${Number(portfolioData.tvl).toLocaleString('en-US', { maximumFractionDigits: 2 })}` : '—'}
                        color="text-on-surface"
                        icon="account_balance_wallet"
                        sub="Simulated virtual balance"
                    />
                    <DataBadge
                        label="Active Strategies"
                        value={portfolioData?.activeAgents != null ? portfolioData.activeAgents : '—'}
                        color="text-primary"
                        icon="hub"
                        sub="Running agent instances"
                    />
                </DataCard>

                {/* 5. RPC / Blockchain Data */}
                <DataCard title="Blockchain Data" icon="link" badge="Sepolia RPC" badgeColor="text-primary">
                    <DataBadge
                        label="Gas Price"
                        value={portfolioData?.gasPrice != null ? `${Number(portfolioData.gasPrice).toFixed(1)} gwei` : '—'}
                        color={portfolioData?.gasPrice == null ? 'text-on-surface-variant' : portfolioData?.gasPrice < 20 ? 'text-success' : portfolioData?.gasPrice < 45 ? 'text-warning' : 'text-error'}
                        icon="local_gas_station"
                        sub={portfolioData?.gasPrice == null ? 'Waiting for RPC data' : portfolioData?.gasPrice < 20 ? 'Low — good for claiming' : portfolioData?.gasPrice < 45 ? 'Moderate' : 'High — avoid transactions'}
                    />
                    <DataBadge
                        label="Block Number"
                        value={portfolioData?.blockNumber ? `#${Number(portfolioData.blockNumber).toLocaleString()}` : 'Not connected'}
                        color={portfolioData?.blockNumber ? 'text-success' : 'text-on-surface-variant'}
                        icon="layers"
                        sub={portfolioData?.blockNumber ? 'Live from RPC provider' : 'Set RPC URL in Settings'}
                    />
                    <DataBadge
                        label="RPC Status"
                        value={portfolioData?.blockNumber ? 'Connected' : 'Simulated'}
                        color={portfolioData?.blockNumber ? 'text-success' : 'text-warning'}
                        icon="cast_connected"
                        sub={portfolioData?.blockNumber ? 'Reading live on-chain data' : 'Configure in Settings → RPC URL'}
                    />
                </DataCard>

                {/* 6. Avg Strategy APY */}
                <DataCard title="Strategy Breakdown" icon="pie_chart" badge="Allocation" badgeColor="text-tertiary">
                    {(portfolioData?.strategies || []).map((s, i) => {
                        const apy = Number(s.apy);
                        const tvl = Number(s.tvl);
                        const safeApy = Number.isFinite(apy) ? apy : null;
                        const alloc = Number.isFinite(tvl) && portfolioData?.tvl ? ((tvl / portfolioData.tvl) * 100).toFixed(0) : null;
                        return (
                            <DataBadge
                                key={i}
                                label={s.name}
                                value={safeApy != null ? `${safeApy.toFixed(2)}%` : '—'}
                                color="text-primary"
                                icon="arrow_right"
                                sub={`${s.protocol || '—'} · ${s.risk || '—'} risk · ${alloc != null ? alloc + '% alloc.' : '—'}`}
                            />
                        );
                    })}
                    {!portfolioData?.strategies?.length && (
                        <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant py-2">Start simulation to see strategy data.</p>
                    )}
                </DataCard>

            </div>

            {/* Live Agent Log Stream */}
            <div className="mt-5 bg-surface-container border border-outline-variant rounded-xl p-5">
                <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-[20px] text-primary">rss_feed</span>
                        <h3 className="font-[Inter] text-[15px] font-semibold text-on-surface">Live Agent Event Stream</h3>
                    </div>
                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">
                        {logs?.length || 0} events captured
                    </span>
                </div>
                <div
                    ref={logContainerRef}
                    className="h-[220px] overflow-y-auto pr-2 space-y-0 scrollbar-thin scrollbar-thumb-outline-variant"
                >
                    {logs && logs.length > 0 ? (
                        [...logs].reverse().map((log, i) => (
                            <LiveLogEntry key={i} log={log} />
                        ))
                    ) : (
                        <div className="flex items-center justify-center h-full text-on-surface-variant font-[JetBrains_Mono] text-[13px]">
                            Waiting for agent events...
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
