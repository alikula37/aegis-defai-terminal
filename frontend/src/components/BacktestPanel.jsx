import { useState, useEffect } from 'react';
import {
    AreaChart, Area, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { apiFetch } from '../lib/apiClient';
import ChartCard from './ChartCard';
import { xAxis, yAxis, grid, tooltipCursor } from './chartTheme';
import { chartColors } from '../lib/chartColors';
import { fmtPct, fmtNumber } from '../lib/format';
import { useI18n } from '../i18n/I18nProvider';

const RANGE_OPTIONS = [30, 90, 180, 365];
const LEVERAGE_OPTIONS = [2, 3, 4, 5, 6];

function MetricCell({ label, value, color = 'text-on-surface' }) {
    return (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-2.5 min-w-0">
            <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant uppercase tracking-wider truncate">{label}</p>
            <p className={`font-[Inter] text-[16px] font-bold mt-1 tabular-nums ${color}`}>{value}</p>
        </div>
    );
}

export default function BacktestPanel() {
    const { t, lang } = useI18n();
    const [rangeDays, setRangeDays] = useState(90);
    const [leverage, setLeverage] = useState(4);
    const [result, setResult] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        setIsLoading(true);
        setError(null);
        apiFetch(`/api/backtest?rangeDays=${rangeDays}&leverage=${leverage}`)
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then(data => {
                if (!alive) return;
                if (data.error) { setError(data.error); setResult(null); return; }
                setResult(data);
            })
            .catch(() => alive && setError(t('analytics.backtestLoadFailed')))
            .finally(() => alive && setIsLoading(false));
        return () => { alive = false; };
    }, [rangeDays, leverage, t]);

    const equityData = (result?.equityCurve || []).map((p, i) => ({ i, equity: Number(p.equity) }));
    const monthlyData = (result?.monthly || []).map(m => ({
        month: m.month,
        returnPct: Number(m.returnPct),
    }));

    return (
        <ChartCard
            title={t('analytics.backtestTitle')}
            subtitle={t('analytics.backtestSubtitle')}
            icon="history"
            glossary="glossary.backtest"
            badge={
                <div className="flex flex-wrap gap-2">
                    <select
                        value={rangeDays}
                        onChange={e => setRangeDays(Number(e.target.value))}
                        aria-label={t('analytics.rangeDays')}
                        className="bg-surface-container-lowest border border-outline-variant rounded-md px-2 py-1 text-[12px] font-[JetBrains_Mono] text-on-surface outline-none focus:border-primary"
                    >
                        {RANGE_OPTIONS.map(d => <option key={d} value={d}>{d}d</option>)}
                    </select>
                    <select
                        value={leverage}
                        onChange={e => setLeverage(Number(e.target.value))}
                        aria-label={t('analytics.leverage')}
                        className="bg-surface-container-lowest border border-outline-variant rounded-md px-2 py-1 text-[12px] font-[JetBrains_Mono] text-on-surface outline-none focus:border-primary"
                    >
                        {LEVERAGE_OPTIONS.map(l => <option key={l} value={l}>{l}x</option>)}
                    </select>
                </div>
            }
        >
            {isLoading ? (
                <div className="flex items-center justify-center h-[220px] text-on-surface-variant">
                    <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>
                </div>
            ) : error ? (
                <div className="flex flex-col items-center justify-center h-[220px] text-center gap-2">
                    <span className="material-symbols-outlined text-error text-3xl">cloud_off</span>
                    <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant max-w-sm">{error}</p>
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2">
                        <MetricCell label={t('analytics.cagr')} value={fmtPct(result.cagr, { locale: lang })} color="text-success" />
                        <MetricCell label={t('analytics.sharpe')} value={fmtNumber(result.sharpe, { locale: lang })} />
                        <MetricCell label={t('analytics.maxDrawdown')} value={fmtPct(result.maxDrawdown, { locale: lang, signed: true })} color="text-error" />
                        <MetricCell label={t('analytics.vaR95')} value={fmtPct(result.vaR95Pct, { locale: lang, signed: true })} color="text-warning" />
                        <MetricCell label={t('analytics.sortino')} value={fmtNumber(result.sortino, { locale: lang })} />
                        <MetricCell label={t('analytics.winRate')} value={fmtPct(result.winRate * 100, { locale: lang, fractionDigits: 0 })} />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Equity curve */}
                        <div className="h-[240px] w-full">
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-1 uppercase tracking-wider">{t('analytics.equityCurve')}</p>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={equityData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="gradBtEquity" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={chartColors.primary} stopOpacity={0.3} />
                                            <stop offset="95%" stopColor={chartColors.primary} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid {...grid} />
                                    <XAxis {...xAxis} dataKey="i" tickFormatter={v => `#${v}`} />
                                    <YAxis {...yAxis} tickFormatter={v => `${v.toFixed(2)}x`} domain={['auto', 'auto']} />
                                    <Tooltip
                                        cursor={tooltipCursor}
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const p = payload[0].payload;
                                            return (
                                                <div className="bg-[#161718]/95 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-2xl">
                                                    <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-1 uppercase tracking-wider">{t('analytics.period')} #{p.i + 1}</p>
                                                    <p className="font-[Inter] text-[13px] font-bold text-primary tabular-nums">{Number(p.equity).toFixed(4)}x</p>
                                                </div>
                                            );
                                        }}
                                    />
                                    <ReferenceLine y={1} stroke={chartColors.border} strokeDasharray="4 4" />
                                    <Area type="monotone" dataKey="equity" stroke={chartColors.primary} strokeWidth={2} fill="url(#gradBtEquity)" isAnimationActive={false} dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>

                        {/* Monthly returns */}
                        <div className="h-[240px] w-full">
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-1 uppercase tracking-wider">{t('analytics.monthlyReturns')}</p>
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={monthlyData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                    <CartesianGrid {...grid} />
                                    <XAxis {...xAxis} dataKey="month" />
                                    <YAxis {...yAxis} tickFormatter={v => `${v}%`} />
                                    <Tooltip
                                        cursor={{ fill: '#ffffff05' }}
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const p = payload[0].payload;
                                            return (
                                                <div className="bg-[#161718]/95 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-2xl">
                                                    <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">{p.month}</p>
                                                    <p className={`font-[Inter] text-[13px] font-bold tabular-nums ${Number(p.returnPct) >= 0 ? 'text-success' : 'text-error'}`}>
                                                        {fmtPct(p.returnPct, { locale: lang, signed: true })}
                                                    </p>
                                                </div>
                                            );
                                        }}
                                    />
                                    <ReferenceLine y={0} stroke={chartColors.border} />
                                    <Bar dataKey="returnPct" radius={[3, 3, 0, 0]}>
                                        {monthlyData.map((m, i) => (
                                            <Cell key={i} fill={m.returnPct >= 0 ? chartColors.success : chartColors.error} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </div>

                    {result.last && (
                        <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">
                            {t('analytics.lastSnapshot', {
                                date: result.last.date,
                                loop: Number(result.last.loopNetApy).toFixed(2),
                            })}
                        </p>
                    )}
                </>
            )}
        </ChartCard>
    );
}