import { useState, useEffect } from 'react';
import {
    AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { apiFetch } from '../lib/apiClient';
import ChartCard from './ChartCard';
import GlossaryTooltip from './GlossaryTooltip';
import { xAxis, yAxis, grid } from './chartTheme';
import { chartColors } from '../lib/chartColors';
import { fmtPct, fmtNumber } from '../lib/format';
import { useI18n } from '../i18n/I18nProvider';

function Metric({ label, value, color = 'text-on-surface', glossary = null }) {
    return (
        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-2.5 min-w-0">
            <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant uppercase tracking-wider truncate flex items-center gap-1">
                <span className="truncate">{label}</span>
                {glossary && <GlossaryTooltip term={glossary} />}
            </p>
            <p className={`font-[Inter] text-[16px] font-bold mt-1 tabular-nums ${color}`}>{value}</p>
        </div>
    );
}

export default function LiveRiskPanel() {
    const { t, lang } = useI18n();
    const [m, setM] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        setIsLoading(true);
        setError(null);
        apiFetch('/api/portfolio/metrics')
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then(data => { if (alive) setM(data); })
            .catch(() => alive && setError(t('analytics.riskLoadFailed')))
            .finally(() => alive && setIsLoading(false));
        return () => { alive = false; };
    }, [t]);

    const equity = Array.isArray(m?.equityCurve) ? m.equityCurve.map((p, i) => ({ i, equity: Number(p.equity) })) : [];
    const hist = Array.isArray(m?.returnHistogram) ? m.returnHistogram.map(h => ({
        bucket: h.bucket,
        count: h.count,
        lower: h.lower,
        upper: h.upper,
    })) : [];
    const rollVol = Array.isArray(m?.rollingVolatility) ? m.rollingVolatility.map(p => ({ i: p.i, vol: Number(p.volPct) })) : [];

    return (
        <ChartCard
            title={t('analytics.liveRiskTitle')}
            subtitle={t('analytics.liveRiskSubtitle')}
            icon="monitoring"
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
                    <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-6 gap-2">
                        <Metric label={t('analytics.sharpe')} value={fmtNumber(m?.sharpeRatio, { locale: lang })} glossary="glossary.sharpe" />
                        <Metric label={t('analytics.sortino')} value={fmtNumber(m?.sortinoRatio, { locale: lang })} glossary="glossary.sortino" />
                        <Metric label={t('analytics.volatility')} value={fmtPct(m?.annualizedVolatilityPct, { locale: lang })} glossary="glossary.volatility" />
                        <Metric label={t('analytics.maxDrawdown')} value={fmtPct(m?.maxDrawdownPct, { locale: lang, signed: true })} color="text-error" glossary="glossary.maxDrawdown" />
                        <Metric label={t('analytics.calmar')} value={fmtNumber(m?.calmarRatio, { locale: lang })} glossary="glossary.calmar" />
                        <Metric label={t('analytics.tailRatio')} value={fmtNumber(m?.tailRatio, { locale: lang })} glossary="glossary.tailRatio" />
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                        {/* Equity curve (normalized) */}
                        <div className="h-[220px] w-full">
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-1 uppercase tracking-wider">{t('analytics.equityCurve')}</p>
                            {equity.length < 2 ? (
                                <div className="h-full flex items-center justify-center text-on-surface-variant font-[JetBrains_Mono] text-[12px]">{t('analytics.noHistory')}</div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={equity} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="gradLiveEquity" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor={chartColors.primary} stopOpacity={0.3} />
                                                <stop offset="95%" stopColor={chartColors.primary} stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid {...grid} />
                                        <XAxis {...xAxis} dataKey="i" />
                                        <YAxis {...yAxis} tickFormatter={v => `${v.toFixed(2)}x`} domain={['auto', 'auto']} />
                                        <Tooltip
                                            cursor={{ stroke: chartColors.border, strokeDasharray: '4 4' }}
                                            content={({ active, payload }) => {
                                                if (!active || !payload?.length) return null;
                                                const p = payload[0].payload;
                                                return (
                                                    <div className="bg-[#161718]/95 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-2xl">
                                                        <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">{t('analytics.period')} #{p.i}</p>
                                                        <p className="font-[Inter] text-[13px] font-bold text-primary tabular-nums">{Number(p.equity).toFixed(4)}x</p>
                                                    </div>
                                                );
                                            }}
                                        />
                                        <ReferenceLine y={1} stroke={chartColors.border} strokeDasharray="4 4" />
                                        <Area type="monotone" dataKey="equity" stroke={chartColors.primary} strokeWidth={2} fill="url(#gradLiveEquity)" isAnimationActive={false} dot={false} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>

                        {/* Return distribution */}
                        <div className="h-[220px] w-full">
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-1 uppercase tracking-wider">{t('analytics.returnDistribution')}</p>
                            {hist.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-on-surface-variant font-[JetBrains_Mono] text-[12px]">{t('analytics.noHistory')}</div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={hist} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                        <CartesianGrid {...grid} />
                                        <XAxis {...xAxis} dataKey="bucket" tickFormatter={v => `${v.toFixed(2)}%`} />
                                        <YAxis {...yAxis} allowDecimals={false} />
                                        <Tooltip
                                            cursor={{ fill: '#ffffff05' }}
                                            content={({ active, payload }) => {
                                                if (!active || !payload?.length) return null;
                                                const p = payload[0].payload;
                                                return (
                                                    <div className="bg-[#161718]/95 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-2xl">
                                                        <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">
                                                            {fmtPct(p.lower, { locale: lang, signed: true })} … {fmtPct(p.upper, { locale: lang, signed: true })}
                                                        </p>
                                                        <p className="font-[Inter] text-[13px] font-bold text-on-surface tabular-nums">{p.count}</p>
                                                    </div>
                                                );
                                            }}
                                        />
                                        <Bar dataKey="count" radius={[3, 3, 0, 0]} fill={chartColors.tertiary} />
                                    </BarChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>

                    {/* Rolling volatility */}
                    {rollVol.length > 1 && (
                        <div className="h-[160px] w-full">
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-1 uppercase tracking-wider">{t('analytics.rollingVolatility')}</p>
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={rollVol} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="gradRollVol" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor={chartColors.warning} stopOpacity={0.3} />
                                            <stop offset="95%" stopColor={chartColors.warning} stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid {...grid} />
                                    <XAxis {...xAxis} dataKey="i" />
                                    <YAxis {...yAxis} tickFormatter={v => `${v}%`} />
                                    <Tooltip
                                        cursor={{ stroke: chartColors.border, strokeDasharray: '4 4' }}
                                        content={({ active, payload }) => {
                                            if (!active || !payload?.length) return null;
                                            const p = payload[0].payload;
                                            return (
                                                <div className="bg-[#161718]/95 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-2xl">
                                                    <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">{t('analytics.period')} #{p.i}</p>
                                                    <p className="font-[Inter] text-[13px] font-bold text-warning tabular-nums">{fmtPct(p.vol, { locale: lang })}</p>
                                                </div>
                                            );
                                        }}
                                    />
                                    <Area type="monotone" dataKey="vol" stroke={chartColors.warning} strokeWidth={2} fill="url(#gradRollVol)" isAnimationActive={false} dot={false} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    )}
                </>
            )}
        </ChartCard>
    );
}