import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { apiFetch } from '../lib/apiClient';

const TABS = ['Backtest', 'Monte Carlo', 'Leverage Sweep'];

function fmtPct(v, digits = 2) {
    if (v == null || isNaN(v)) return '—';
    const sign = v > 0 ? '+' : '';
    return `${sign}${Number(v).toFixed(digits)}%`;
}

function fmtNum(v, digits = 4) {
    if (v == null || isNaN(v)) return '—';
    return Number(v).toFixed(digits);
}

export default function BacktestPanel() {
    const [tab, setTab] = useState('Backtest');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [params, setParams] = useState({ rangeDays: 90, leverage: 4, simulations: 500, meanApy: 8, sigmaApy: 10 });
    const [result, setResult] = useState(null);

    const run = async (type) => {
        setLoading(true);
        setError(null);
        setResult(null);
        try {
            const q = new URLSearchParams();
            if (type === 'backtest') {
                q.set('rangeDays', params.rangeDays);
                q.set('leverage', params.leverage);
            } else if (type === 'montecarlo') {
                q.set('simulations', params.simulations);
                q.set('days', params.rangeDays);
                q.set('leverage', params.leverage);
                q.set('meanApy', params.meanApy);
                q.set('sigmaApy', params.sigmaApy);
            }
            const path = type === 'backtest' ? '/api/backtest' : type === 'montecarlo' ? '/api/backtest/monte-carlo' : '/api/backtest/sweep';
            const res = await apiFetch(`${path}${q.size ? '?' + q.toString() : ''}`);
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Backtest failed');
            setResult({ type, data });
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const numberInput = (label, key, step = 1) => (
        <label className="flex flex-col gap-1 font-[JetBrains_Mono] text-[11px] text-on-surface-variant">
            {label}
            <input
                type="number"
                step={step}
                value={params[key]}
                onChange={e => setParams(p => ({ ...p, [key]: Number(e.target.value) }))}
                className="bg-surface-container-lowest border border-outline-variant rounded-md px-3 py-2 font-[JetBrains_Mono] text-[13px] text-on-surface focus:outline-none focus:border-primary"
            />
        </label>
    );

    return (
        <div className="bg-surface-container border border-outline-variant rounded-xl p-[1.5rem]">
            {/* Header */}
            <div className="flex justify-between items-start mb-4">
                <div>
                    <h3 className="font-[Inter] text-[16px] font-semibold text-on-surface">Strategy Backtest</h3>
                    <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-0.5">
                        Real historical APY · DefiLlama + Morpho + Hyperliquid
                    </p>
                </div>
                <div className="flex gap-1 bg-surface-container-lowest rounded-lg p-1 border border-outline-variant/30">
                    {TABS.map(t => (
                        <button
                            key={t}
                            onClick={() => { setTab(t); setResult(null); }}
                            className={`px-2.5 py-1 rounded text-[10px] font-[JetBrains_Mono] font-bold transition-colors ${tab === t ? 'bg-primary/20 text-primary' : 'text-on-surface-variant hover:text-on-surface'}`}
                        >
                            {t}
                        </button>
                    ))}
                </div>
            </div>

            {/* Controls */}
            <div className="flex flex-wrap items-end gap-4 mb-4">
                {tab === 'Backtest' && (
                    <>
                        {numberInput('Range (days)', 'rangeDays')}
                        {numberInput('Leverage (x)', 'leverage', 0.5)}
                        <button
                            onClick={() => run('backtest')}
                            disabled={loading}
                            className="px-4 py-2 rounded-md font-[JetBrains_Mono] text-[12px] font-bold bg-primary text-on-primary hover:bg-primary-fixed hover:text-on-primary-fixed disabled:opacity-40 transition-colors"
                        >
                            {loading ? 'Running...' : 'Run Backtest'}
                        </button>
                    </>
                )}
                {tab === 'Monte Carlo' && (
                    <>
                        {numberInput('Simulations', 'simulations', 100)}
                        {numberInput('Range (days)', 'rangeDays')}
                        {numberInput('Leverage (x)', 'leverage', 0.5)}
                        {numberInput('Mean APY (%)', 'meanApy', 0.5)}
                        {numberInput('Sigma APY (%)', 'sigmaApy', 0.5)}
                        <button
                            onClick={() => run('montecarlo')}
                            disabled={loading}
                            className="px-4 py-2 rounded-md font-[JetBrains_Mono] text-[12px] font-bold bg-primary text-on-primary hover:bg-primary-fixed hover:text-on-primary-fixed disabled:opacity-40 transition-colors"
                        >
                            {loading ? 'Running...' : 'Run Monte Carlo'}
                        </button>
                    </>
                )}
                {tab === 'Leverage Sweep' && (
                    <>
                        {numberInput('Range (days)', 'rangeDays')}
                        <button
                            onClick={() => run('sweep')}
                            disabled={loading}
                            className="px-4 py-2 rounded-md font-[JetBrains_Mono] text-[12px] font-bold bg-primary text-on-primary hover:bg-primary-fixed hover:text-on-primary-fixed disabled:opacity-40 transition-colors"
                        >
                            {loading ? 'Running...' : 'Run Sweep'}
                        </button>
                    </>
                )}
            </div>

            {error && (
                <p className="font-[JetBrains_Mono] text-[12px] text-red-400 mb-3">⚠ {error}</p>
            )}

            {/* Results */}
            {result?.type === 'backtest' && result.data && !result.data.error && (
                <>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                        <Metric label="Total Return" value={fmtPct(result.data.totalReturn)} />
                        <Metric label="CAGR" value={fmtPct(result.data.cagr)} />
                        <Metric label="Sharpe" value={fmtNum(result.data.sharpe)} />
                        <Metric label="Max Drawdown" value={fmtPct(-result.data.maxDrawdown)} />
                        <Metric label="Days Analyzed" value={String(result.data.days)} plain />
                        <Metric label="Liquidation Price" value={'$' + fmtNum(result.data.liquidationPriceAtLeverage, 3)} plain />
                        <Metric label="Latest Spread" value={fmtPct(result.data.last?.loopNetApy)} />
                        <Metric label="Period" value={`${result.data.startDate} → ${result.data.endDate}`} plain small />
                    </div>
                    {result.data.equityCurve?.length > 1 && (
                        <div className="mt-2 h-48">
                            <ResponsiveContainer width="100%" height="100%">
                                <LineChart data={result.data.equityCurve} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#444746" opacity={0.2} vertical={false} />
                                    <XAxis dataKey="date" stroke="#8e918f" fontSize={10} fontFamily="JetBrains Mono" tickLine={false} axisLine={false} tickMargin={8} minTickGap={30} />
                                    <YAxis stroke="#8e918f" fontSize={10} fontFamily="JetBrains Mono" tickFormatter={v => `${(v - 1) * 100 >= 0 ? '+' : ''}${((v - 1) * 100).toFixed(1)}%`} tickLine={false} axisLine={false} tickMargin={6} width={56} />
                                    <Tooltip
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const p = payload[0].payload;
                                            return (
                                                <div className="bg-[#1a1d1e]/95 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-2xl">
                                                    <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant">{p.date}</p>
                                                    <p className="font-[JetBrains_Mono] text-[12px] font-bold text-on-surface mt-1">
                                                        {((p.equity - 1) * 100 >= 0 ? '+' : '')}{((p.equity - 1) * 100).toFixed(2)}%
                                                    </p>
                                                </div>
                                            );
                                        }}
                                    />
                                    <ReferenceLine y={1} stroke="#8e918f" strokeDasharray="4 4" opacity={0.4} />
                                    <Line type="monotone" dataKey="equity" stroke="#8ab4f8" strokeWidth={2} dot={false} isAnimationActive={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </>
            )}

            {result?.type === 'montecarlo' && result.data && !result.data.error && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                    <Metric label="Liquidation Prob." value={fmtPct(result.data.liquidationProbability * 100)} />
                    <Metric label="Median Return" value={fmtPct(result.data.medianReturnPct)} />
                    <Metric label="P5 (Worst)" value={fmtPct(result.data.p5ReturnPct)} />
                    <Metric label="P95 (Best)" value={fmtPct(result.data.p95ReturnPct)} />
                    <Metric label="Mean Return" value={fmtPct(result.data.meanReturnPct)} />
                    <Metric label="Simulations" value={String(result.data.simulations)} plain />
                    <Metric label="Leverage" value={`${result.data.leverage}x`} plain />
                    <Metric label="Liquidation Price" value={'$' + fmtNum(result.data.liquidationPriceAtLeverage, 3)} plain />
                </div>
            )}

            {result?.type === 'sweep' && result.data && (
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant border-b border-outline-variant">
                                <th className="py-2 pr-4">Leverage</th>
                                <th className="py-2 pr-4">CAGR</th>
                                <th className="py-2 pr-4">Sharpe</th>
                                <th className="py-2">Max Drawdown</th>
                            </tr>
                        </thead>
                        <tbody>
                            {result.data.map(r => (
                                <tr key={r.leverage} className="font-[JetBrains_Mono] text-[12px] text-on-surface border-b border-outline-variant/30">
                                    <td className="py-2 pr-4">{r.leverage}x</td>
                                    <td className="py-2 pr-4">{fmtPct(r.cagr)}</td>
                                    <td className="py-2 pr-4">{fmtNum(r.sharpe)}</td>
                                    <td className="py-2">{fmtPct(-r.maxDrawdown)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {result?.data?.error && (
                <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant">⚠ {result.data.error}</p>
            )}
        </div>
    );
}

function Metric({ label, value, plain, small }) {
    return (
        <div className="bg-surface-container-lowest border border-outline-variant/50 rounded-lg p-3">
            <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant mb-1">{label}</p>
            <p className={`font-[Inter] font-bold ${small ? 'text-[13px]' : 'text-[18px]'} ${plain ? 'text-on-surface' : value.startsWith('-') ? 'text-red-400' : value.startsWith('+') ? 'text-green-400' : 'text-on-surface'}`}>
                {value}
            </p>
        </div>
    );
}
