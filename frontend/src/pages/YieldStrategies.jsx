import { useState, useEffect } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import StrategyMarketplace from '../components/StrategyMarketplace';
import AutomationParameters from '../components/AutomationParameters';
import TransactionAnalytics from '../components/TransactionAnalytics';
import PortfolioAllocationChart from '../components/PortfolioAllocationChart';
import PointsTracker from '../components/PointsTracker';
import CrossChainArbitrage from '../components/CrossChainArbitrage';
import BacktestPanel from '../components/BacktestPanel';

const PLACEHOLDER_STRATEGIES = [
    { name: 'Pendle PT-sUSDe Arb', protocol: 'Pendle Finance', apy: 35.5, risk: 'Low', tvl: 0, borrowProtocol: 'Aave V4 E-Mode', status: 'ACTIVE' },
    { name: 'PT-syrupUSDC RWA', protocol: 'Maple Finance + Aave V4', apy: 12.8, risk: 'Low', tvl: 0, borrowProtocol: 'Aave V4 E-Mode', status: 'ACTIVE' },
    { name: 'Ethena sUSDe Leverage', protocol: 'Ethena + Morpho', apy: 28.4, risk: 'Med', tvl: 0, borrowProtocol: 'Morpho Blue', status: 'ACTIVE' },
    { name: 'Boros YU Hedge', protocol: 'Pendle Boros', apy: 1.2, risk: 'Med', tvl: 0, borrowProtocol: 'N/A (Margin)', status: 'STANDBY' },
    { name: 'Morpho USDC Revolver', protocol: 'Morpho Blue', apy: 12.1, risk: 'Low', tvl: 0, borrowProtocol: 'N/A (Supply)', status: 'ACTIVE' },
];

export default function YieldStrategies() {
    const { portfolioData: liveData, isSimulationRunning, setIsStartModalOpen, setIsResumeModalOpen } = useWebSocket();
    const [isLoading, setIsLoading] = useState(true);

    // Show brief loading indicator, then show placeholder/live data
    useEffect(() => {
        const timer = setTimeout(() => setIsLoading(false), 2500);
        return () => clearTimeout(timer);
    }, []);

    const strategies = liveData?.strategies?.length > 0 ? liveData.strategies : PLACEHOLDER_STRATEGIES;

    if (isLoading) {
        return (
            <div className="p-8 max-w-7xl mx-auto flex flex-col items-center justify-center min-h-[60vh]">
                <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-6"></div>
                <h2 className="font-[Inter] text-[22px] font-bold text-on-surface mb-2">Loading Yield Strategies</h2>
                <p className="font-[JetBrains_Mono] text-[13px] text-on-surface-variant text-center max-w-md">
                    Connecting to DeFiLlama feeds...
                </p>
            </div>
        );
    }

    const isSimulationStarted = isSimulationRunning || hasData;

    if (!isSimulationStarted) {
        return (
            <main className="flex-1 overflow-y-auto p-[2rem] bg-background flex flex-col items-center justify-center min-h-screen">
                <div className="bg-surface-container border border-outline-variant rounded-xl p-8 max-w-md w-full text-center shadow-2xl">
                    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <span className="material-symbols-outlined text-primary text-3xl">rocket_launch</span>
                    </div>
                    <h2 className="font-[Inter] text-[24px] font-bold text-on-surface mb-2">Simulation Idle</h2>
                    <p className="font-[JetBrains_Mono] text-[14px] text-on-surface-variant mb-8">
                        The AI agent is currently idle. Start the simulation to view live portfolio metrics and agent activity.
                    </p>
                    <div className="flex gap-4 max-w-sm mx-auto">
                        <button
                            onClick={() => setIsStartModalOpen(true)}
                            className="flex-1 py-3 rounded-md font-[JetBrains_Mono] text-[14px] font-medium transition-colors flex items-center justify-center gap-2 bg-primary text-on-primary hover:bg-primary-fixed hover:text-on-primary-fixed"
                        >
                            <span className="material-symbols-outlined text-[18px]">play_circle</span>
                            Start New
                        </button>
                        <button
                            onClick={() => setIsResumeModalOpen(true)}
                            className="flex-1 py-3 rounded-md font-[JetBrains_Mono] text-[14px] font-medium transition-colors flex items-center justify-center gap-2 border border-primary text-primary hover:bg-primary/10"
                        >
                            <span className="material-symbols-outlined text-[18px]">restore</span>
                            Resume
                        </button>
                    </div>
                </div>
            </main>
        );
    }

    const totalValueLocked = liveData?.tvl != null
        ? `$${Number(liveData.tvl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '$0.00';

    const netApy = liveData?.netApy != null
        ? `${Number(liveData.netApy) > 0 ? '+' : ''}${Number(liveData.netApy).toFixed(2)}%`
        : '0.00%';

    const activeAgents = isSimulationRunning ? '1' : '0';

    const yieldMetrics = [
        {
            label: 'Total Value Locked',
            value: totalValueLocked,
            glowColor: 'bg-primary/5 group-hover:bg-primary/10',
            valueColor: 'text-on-surface',
            sub: { icon: 'trending_up', text: 'Live Agent Capital', color: 'text-success' },
            bar: null,
        },
        {
            label: 'Net APY',
            value: netApy,
            glowColor: 'bg-success/5 group-hover:bg-success/10',
            valueColor: Number(liveData?.netApy) > 0 ? 'text-green-400' : 'text-red-500',
            sub: { icon: 'info', text: 'Aggregated return', color: 'text-on-surface-variant' },
            bar: null,
        },
        {
            label: 'Active Agents',
            value: activeAgents,
            glowColor: 'bg-tertiary-container/5 group-hover:bg-tertiary-container/10',
            valueColor: 'text-on-surface',
            sub: null,
            bar: true,
            suffix: 'Running',
        },
    ];

    return (
        <main className="flex-1 overflow-y-auto p-[2rem] bg-background pb-12">
            <div className="max-w-[1200px] mx-auto space-y-[1rem]">
                {/* Active State Banner */}
                <div className="flex items-center gap-6 bg-surface-container border border-outline-variant rounded-md p-4">
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

                {/* Metric Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-[1rem]">
                    {yieldMetrics.map((m) => (
                        <div key={m.label} className="bg-surface-container border border-outline-variant rounded-xl p-6 relative overflow-hidden group hover:border-outline transition-colors">
                            <div className={`absolute -right-4 -top-4 w-24 h-24 ${m.glowColor} rounded-full blur-xl transition-all`}></div>
                            <p className="font-[JetBrains_Mono] text-[13px] leading-[16px] font-medium text-on-surface-variant mb-2">{m.label}</p>

                            {m.suffix ? (
                                <h3 className={`font-[Inter] text-[48px] leading-[56px] tracking-[-0.02em] font-bold ${m.valueColor} flex items-center gap-3`}>
                                    {m.value}
                                    <span className="font-[Inter] text-[20px] leading-[28px] font-semibold text-on-surface-variant font-normal">{m.suffix}</span>
                                </h3>
                            ) : (
                                <h3 className={`font-[Inter] text-[48px] leading-[56px] tracking-[-0.02em] font-bold ${m.valueColor}`}>{m.value}</h3>
                            )}

                            {m.bar && (
                                <div className="mt-4 flex gap-1">
                                    {Array.from({ length: Number(activeAgents) || 0 }).map((_, i) => (
                                        <div key={i} className="w-1/4 h-1 bg-success rounded-full"></div>
                                    ))}
                                </div>
                            )}

                            {m.sub && (
                                <div className={`mt-4 flex items-center gap-2 ${m.sub.color}`}>
                                    <span className="material-symbols-outlined text-[16px]">{m.sub.icon}</span>
                                    <span className="font-[JetBrains_Mono] text-[12px] leading-[18px]">{m.sub.text}</span>
                                </div>
                            )}
                        </div>
                    ))}
                </div>

                {/* Strategy Marketplace */}
                <div className="mt-8">
                    <StrategyMarketplace strategies={strategies} />
                </div>

                {/* Strategy Backtest */}
                <div className="mt-8">
                    <BacktestPanel />
                </div>

                {/* Automation Parameters */}
                <div className="mt-8">
                    <AutomationParameters />
                </div>

                {/* Charts Grid */}
                <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-[1rem]">
                    <div className="lg:col-span-2">
                        <TransactionAnalytics />
                    </div>
                    <div className="lg:col-span-1">
                        <PortfolioAllocationChart />
                    </div>
                </div>

                {/* Analytics + Points + Cross-Chain bottom section */}
                <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-[1rem]">
                    <PointsTracker />
                    <CrossChainArbitrage />
                </div>
            </div>
        </main>
    );
}
