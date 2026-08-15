import { apiFetch } from '../lib/apiClient';
import { useState, useEffect } from 'react';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    ScatterChart, Scatter, ZAxis, Cell
} from 'recharts';

function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
}

export default function TransactionAnalytics() {
    const [transactions, setTransactions] = useState([]);
    const [portfolioStats, setPortfolioStats] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
        Promise.all([
            apiFetch('/api/analytics/transactions?limit=100').then(res => res.json()),
            apiFetch('/api/portfolio').then(res => res.json()),
            apiFetch('/api/portfolio/initial').then(res => res.json())
        ])
            .then(([txData, currentPortfolio, initialPortfolio]) => {
                // One malformed row (e.g. NULL market_state_json) must never
                // blank the whole analytics page — skip it and keep the rest.
                const formattedData = (Array.isArray(txData) ? txData : []).reverse().flatMap(tx => {
                    try {
                        const marketState = JSON.parse(tx.market_state_json);
                        return [{
                            id: tx.id,
                            time: fmtTime(tx.timestamp),
                            action: tx.action_taken,
                            pnl: tx.profit_loss,
                            netApy: marketState.netApy || 0,
                            healthFactor: marketState.portfolio?.healthFactor || 0,
                            isSuccessful: tx.is_successful === 1
                        }];
                    } catch {
                        return [];
                    }
                });
                setTransactions(formattedData);

                if (currentPortfolio && initialPortfolio) {
                    setPortfolioStats({
                        currentTvl: currentPortfolio.tvl,
                        initialTvl: initialPortfolio.tvl,
                        totalYield: currentPortfolio.tvl - initialPortfolio.tvl
                    });
                }
            })
            .catch(err => {
                console.error('Failed to fetch analytics data:', err);
                setLoadError('Could not load transaction analytics — check the backend connection.');
            })
            .finally(() => setIsLoading(false));
    }, []);

    if (isLoading) {
        return (
            <div className="bg-surface-container border border-outline-variant rounded-xl p-6 flex items-center justify-center min-h-[300px]">
                <span className="material-symbols-outlined animate-spin text-primary text-3xl">progress_activity</span>
            </div>
        );
    }

    if (loadError) {
        return (
            <div className="bg-surface-container border border-outline-variant rounded-xl p-6 flex flex-col items-center justify-center min-h-[300px] text-center">
                <span className="material-symbols-outlined text-error text-3xl mb-3">cloud_off</span>
                <p className="font-[JetBrains_Mono] text-[13px] text-on-surface-variant max-w-xs">{loadError}</p>
            </div>
        );
    }

    if (transactions.length === 0) {
        return (
            <div className="bg-surface-container border border-outline-variant rounded-xl p-6 flex flex-col items-center justify-center min-h-[300px]">
                <span className="material-symbols-outlined text-on-surface-variant text-4xl mb-2">analytics</span>
                <p className="font-[JetBrains_Mono] text-sm text-on-surface-variant">No transactions recorded yet.</p>
            </div>
        );
    }

    const CustomTooltip = ({ active, payload, _label }) => {
        if (!active || !payload || !payload.length) return null;
        const data = payload[0].payload;
        return (
            <div className="bg-[#161718]/95 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-2xl min-w-[200px]">
                <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-2 pb-2 border-b border-white/10">
                    {data.time}
                </p>
                <p className="font-[Inter] text-[13px] text-on-surface mb-2">{data.action}</p>
                <div className="flex justify-between items-center gap-4">
                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">Status:</span>
                    <span className={`font-[Inter] text-[13px] font-bold ${data.isSuccessful ? 'text-success' : 'text-error'}`}>
                        {data.isSuccessful ? 'Executed (Closed)' : 'Executed (Net Loss)'}
                    </span>
                </div>
                <div className="flex justify-between items-center gap-4">
                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">Est. Tx Impact:</span>
                    <span className={`font-[Inter] text-[13px] font-bold ${Number(data.pnl) >= 0 ? 'text-success' : 'text-error'}`}>
                        ${Number(data.pnl ?? 0).toFixed(2)}
                    </span>
                </div>
                <div className="flex justify-between items-center gap-4">
                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">Net APY:</span>
                    <span className="font-[Inter] text-[13px] font-bold text-primary">
                        {Number(data.netApy ?? 0).toFixed(2)}%
                    </span>
                </div>
                {data.pnl < 0 && (
                    <p className="font-[Inter] text-[10px] text-on-surface-variant mt-2 pt-2 border-t border-white/10 leading-tight">
                        * Reflects immediate execution costs (gas/bridge fees), not a loss on deployed capital. This transaction is completed.
                    </p>
                )}
            </div>
        );
    };

    // Calculate summaries
    const totalTxCosts = transactions.reduce((sum, tx) => sum + (tx.pnl < 0 ? tx.pnl : 0), 0);
    const totalTxProfits = transactions.reduce((sum, tx) => sum + (tx.pnl > 0 ? tx.pnl : 0), 0);

    const totalYieldAccrued = portfolioStats ? portfolioStats.totalYield : 0;

    const formatCurrency = (val) => {
        const isNegative = val < 0;
        const absVal = Math.abs(val);
        return `${isNegative ? '-' : '+'}$${absVal.toFixed(2)}`;
    };

    return (
        <div className="flex flex-col gap-[1rem]">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-[1rem]">
                <div className="bg-surface-container border border-outline-variant rounded-xl p-5 flex flex-col justify-center">
                    <span className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Total Yield Accrued</span>
                    <span className={`font-[Inter] text-[24px] font-bold ${totalYieldAccrued >= 0 ? 'text-success' : 'text-error'}`}>
                        {formatCurrency(totalYieldAccrued)}
                    </span>
                    <span className="font-[Inter] text-[11px] text-on-surface-variant mt-1">Realized portfolio growth</span>
                </div>
                <div className="bg-surface-container border border-outline-variant rounded-xl p-5 flex flex-col justify-center">
                    <span className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Total Execution Costs</span>
                    <span className="font-[Inter] text-[24px] font-bold text-error">
                        -${Math.abs(totalTxCosts).toFixed(2)}
                    </span>
                    <span className="font-[Inter] text-[11px] text-on-surface-variant mt-1">Gas, bridge fees & rebalances</span>
                </div>
                <div className="bg-surface-container border border-outline-variant rounded-xl p-5 flex flex-col justify-center">
                    <span className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Estimated Value Created</span>
                    <span className="font-[Inter] text-[24px] font-bold text-success">
                        +${totalTxProfits.toFixed(2)}
                    </span>
                    <span className="font-[Inter] text-[11px] text-on-surface-variant mt-1">Projected savings & arb profits</span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-[1rem]">
                {/* Transaction PnL Chart */}
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6">
                    <h3 className="font-[Inter] text-[16px] font-semibold text-on-surface mb-6 flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary">bar_chart</span>
                        Estimated Transaction Impact (PnL)
                    </h3>
                    <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={transactions} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                                <XAxis dataKey="time" stroke="#ffffff40" fontSize={10} tickLine={false} axisLine={false} />
                                <YAxis stroke="#ffffff40" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `$${val}`} />
                                <Tooltip content={<CustomTooltip />} cursor={{ fill: '#ffffff05' }} />
                                <Bar dataKey="pnl" radius={[4, 4, 0, 0]}>
                                    {transactions.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.pnl >= 0 ? '#27a644' : '#eb5757'} />
                                    ))}
                                </Bar>
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </div>

                {/* Transaction Yield Rate Chart */}
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6">
                    <h3 className="font-[Inter] text-[16px] font-semibold text-on-surface mb-6 flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary">scatter_plot</span>
                        Yield Rate at Transaction
                    </h3>
                    <div className="h-[250px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ScatterChart margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                                <XAxis dataKey="time" type="category" allowDuplicatedCategory={false} stroke="#ffffff40" fontSize={10} tickLine={false} axisLine={false} />
                                <YAxis dataKey="netApy" type="number" stroke="#ffffff40" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(val) => `${val}%`} domain={['auto', 'auto']} />
                                <ZAxis dataKey="pnl" range={[50, 400]} />
                                <Tooltip content={<CustomTooltip />} cursor={{ strokeDasharray: '3 3' }} />
                                <Scatter name="Transactions" data={transactions} fill="#17c3b2" fillOpacity={0.8} />
                            </ScatterChart>
                        </ResponsiveContainer>
                    </div>
                </div>
            </div>
        </div>
    );
}
