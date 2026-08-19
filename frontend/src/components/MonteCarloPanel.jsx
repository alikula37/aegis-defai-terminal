import { useState, useEffect } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { apiFetch } from '../lib/apiClient';
import ChartCard from './ChartCard';
import { xAxis, yAxis, grid } from './chartTheme';
import { chartColors } from '../lib/chartColors';
import { fmtPct } from '../lib/format';
import { useI18n } from '../i18n/I18nProvider';

const DAY_OPTIONS = [30, 90, 180];
const LEVERAGE_OPTIONS = [2, 3, 4, 5, 6];

function Stat({ label, value, color = 'text-on-surface', sub = null }) {
    return (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-3 min-w-0">
            <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant uppercase tracking-wider truncate">{label}</p>
            <p className={`font-[Inter] text-[20px] font-bold mt-1 tabular-nums ${color}`}>{value}</p>
            {sub && <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant mt-0.5">{sub}</p>}
        </div>
    );
}

export default function MonteCarloPanel() {
    const { t, lang } = useI18n();
    const [days, setDays] = useState(90);
    const [leverage, setLeverage] = useState(4);
    const [result, setResult] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        setIsLoading(true);
        setError(null);
        apiFetch(`/api/backtest/monte-carlo?days=${days}&leverage=${leverage}&simulations=1000`)
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then(data => {
                if (!alive) return;
                if (data.error) { setError(data.error); setResult(null); return; }
                setResult(data);
            })
            .catch(() => alive && setError(t('analytics.mcLoadFailed')))
            .finally(() => alive && setIsLoading(false));
        return () => { alive = false; };
    }, [days, leverage, t]);

    const distribution = Array.isArray(result?.distribution) ? result.distribution : [];
    const liqPct = Number(result?.liquidationProbability ?? 0) * 100;

    return (
        <ChartCard
            title={t('analytics.mcTitle')}
            subtitle={t('analytics.mcSubtitle')}
            icon="casino"
            badge={
                <div className="flex flex-wrap gap-2">
                    <select
                        value={days}
                        onChange={e => setDays(Number(e.target.value))}
                        aria-label={t('analytics.days')}
                        className="bg-surface-container-lowest border border-outline-variant rounded-md px-2 py-1 text-[12px] font-[JetBrains_Mono] text-on-surface outline-none focus:border-primary"
                    >
                        {DAY_OPTIONS.map(d => <option key={d} value={d}>{d}d</option>)}
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
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                        <Stat
                            label={t('analytics.liquidationProbability')}
                            value={fmtPct(liqPct, { locale: lang, fractionDigits: 1 })}
                            color={liqPct > 10 ? 'text-error' : liqPct > 2 ? 'text-warning' : 'text-success'}
                            sub={t('analytics.mcSims', { n: result.simulations })}
                        />
                        <Stat label={t('analytics.medianReturn')} value={fmtPct(result.medianReturnPct, { locale: lang, signed: true })} color="text-on-surface" />
                        <Stat label={t('analytics.p5Return')} value={fmtPct(result.p5ReturnPct, { locale: lang, signed: true })} color="text-warning" />
                        <Stat label={t('analytics.p95Return')} value={fmtPct(result.p95ReturnPct, { locale: lang, signed: true })} color="text-success" />
                    </div>

                    <div className="h-[240px] w-full">
                        <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-1 uppercase tracking-wider">{t('analytics.returnDistribution')}</p>
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={distribution} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid {...grid} />
                                <XAxis
                                    {...xAxis}
                                    dataKey="bucket"
                                    tickFormatter={v => `${v.toFixed(0)}%`}
                                    type="category"
                                />
                                <YAxis {...yAxis} tickFormatter={v => `${v}`} allowDecimals={false} />
                                <Tooltip
                                    cursor={{ fill: '#ffffff05' }}
                                    content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null;
                                        const p = payload[0].payload;
                                        return (
                                            <div className="bg-[#161718]/95 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-2xl">
                                                <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">
                                                    {fmtPct(p.bucket, { locale: lang, signed: true })}
                                                </p>
                                                <p className="font-[Inter] text-[13px] font-bold text-on-surface tabular-nums">
                                                    {p.count} <span className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant">{t('analytics.outOf', { n: result.simulations })}</span>
                                                </p>
                                            </div>
                                        );
                                    }}
                                />
                                <Bar dataKey="count" radius={[3, 3, 0, 0]} fill={chartColors.tertiary} isAnimationActive={false} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                </>
            )}
        </ChartCard>
    );
}