import { useState, useEffect, useMemo } from 'react';
import { fetchJson } from '../lib/apiClient';
import { chartColors } from '../lib/chartColors';
import GlossaryTooltip from './GlossaryTooltip';
import { useI18n } from '../i18n/I18nProvider';
import {
    ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';

const METRIC_KEYS = [
    { key: 'sharpeRatio', glossary: 'glossary.sharpe' },
    { key: 'sortinoRatio', glossary: null },
    { key: 'annualizedVolatilityPct', glossary: null },
    { key: 'historicalVaRPct', glossary: 'glossary.var' },
    { key: 'maxDrawdownPct', glossary: null },
    { key: 'winRate', glossary: null },
];

export default function ForecastChart() {
    const { t } = useI18n();
    const [metrics, setMetrics] = useState(null);
    const [forecast, setForecast] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        Promise.all([
            fetchJson('/api/portfolio/metrics').catch(e => { throw e; }),
            fetchJson('/api/forecast/netApy?horizon=12').catch(e => { throw e; }),
        ])
            .then(([m, f]) => {
                if (!alive) return;
                setMetrics(m);
                setForecast(f);
            })
            .catch(() => alive && setError(t('forecast.loadFailed')));
        return () => { alive = false; };
    }, [t]);

    const data = useMemo(() => {
        if (!forecast || !forecast.fitted.length) return [];
        const history = forecast.fitted.map(pt => ({
            time: `${pt.i}`,
            actual: pt.value,
            fitted: pt.forecast,
        }));
        const future = forecast.future.map(pt => ({
            time: `+${pt.step}`,
            fitted: pt.value,
            upper: pt.upper,
            lower: pt.lower,
        }));
        // Join with a shared point so the line is continuous.
        const last = history[history.length - 1];
        if (future.length && last) {
            future[0] = { ...future[0], time: last.time, actual: last.actual, fitted: last.actual };
        }
        return [...history, ...future];
    }, [forecast]);

    const CustomTooltip = ({ active, payload, label }) => {
        if (!active || !payload || !payload.length) return null;
        const p = payload[0].payload;
        return (
            <div className="bg-surface-container-high border border-outline-variant rounded-xl p-4 shadow-2xl min-w-[160px]">
                <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-2 pb-2 border-b border-outline-variant/60">
                    {label}
                </p>
                {p.actual != null && (
                    <p className="flex justify-between gap-4 text-[12px]">
                        <span className="text-on-surface-variant">{t('forecast.actual')}</span>
                        <span className="font-mono text-on-surface font-bold">{Number(p.actual).toFixed(2)}%</span>
                    </p>
                )}
                {p.fitted != null && (
                    <p className="flex justify-between gap-4 text-[12px] mt-1">
                        <span className="text-on-surface-variant">{t('forecast.point')}</span>
                        <span className="font-mono text-primary font-bold">{Number(p.fitted).toFixed(2)}%</span>
                    </p>
                )}
                {p.upper != null && (
                    <p className="flex justify-between gap-4 text-[11px] mt-1">
                        <span className="text-on-surface-variant">{t('forecast.band')}</span>
                        <span className="font-mono text-on-surface-variant">{Number(p.lower).toFixed(2)} … {Number(p.upper).toFixed(2)}</span>
                    </p>
                )}
            </div>
        );
    };

    const hasData = data.length > 0 && forecast?.fitted?.length > 0;

    return (
        <div className="bg-surface-container border border-outline-variant rounded-xl p-6 flex flex-col gap-4">
            <div className="flex justify-between items-start">
                <div>
                    <h3 className="font-[Inter] text-[16px] font-semibold text-on-surface flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary">monitoring</span>
                        {t('forecast.title')}
                        <GlossaryTooltip term="glossary.forecast" />
                    </h3>
                    <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant mt-1">
                        {t('forecast.subtitle')}
                    </p>
                </div>
                {metrics && metrics.periods > 0 && (
                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant bg-surface-container-lowest px-2 py-1 rounded-full border border-outline-variant">
                        {t('forecast.samples', { n: metrics.periods })}
                    </span>
                )}
            </div>

            {/* Risk metric strip */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                {METRIC_KEYS.map(m => (
                    <div key={m.key} className="bg-surface-container-lowest border border-outline-variant rounded-lg p-2.5">
                        <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant uppercase tracking-wider flex items-center gap-1">
                            {t(`forecast.${m.key}`)}
                            {m.glossary && <GlossaryTooltip term={m.glossary} />}
                        </p>
                        <p className="font-[Inter] text-[16px] font-bold text-on-surface mt-1">
                            {metrics ? formatMetric(m.key, metrics[m.key]) : '—'}
                        </p>
                    </div>
                ))}
            </div>

            {error && (
                <p className="text-[12px] text-error font-[JetBrains_Mono]">{error}</p>
            )}

            <div className="h-[220px] w-full">
                {!hasData ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 text-on-surface-variant">
                        <span className="material-symbols-outlined text-[36px] opacity-40">monitoring</span>
                        <p className="font-[JetBrains_Mono] text-[12px] opacity-60">{t('forecast.waitingData')}</p>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={data} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                            <defs>
                                <linearGradient id="gradForecastBand" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={chartColors.tertiary} stopOpacity={0.25} />
                                    <stop offset="95%" stopColor={chartColors.tertiary} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke={chartColors.border} vertical={false} />
                            <XAxis dataKey="time" stroke="#ffffff40" fontSize={10} tickLine={false} axisLine={false} minTickGap={20} />
                            <YAxis stroke="#ffffff40" fontSize={10} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} domain={['auto', 'auto']} />
                            <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#ffffff20', strokeWidth: 1, strokeDasharray: '3 3' }} />
                            <Area
                                type="monotone"
                                dataKey="upper"
                                stroke="none"
                                fill="url(#gradForecastBand)"
                                isAnimationActive={false}
                            />
                            <Line type="monotone" dataKey="actual" name={t('forecast.actual')} stroke={chartColors.primary} strokeWidth={2} dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="fitted" name={t('forecast.point')} stroke={chartColors.tertiary} strokeWidth={2} strokeDasharray="5 3" dot={false} isAnimationActive={false} />
                            <Line type="monotone" dataKey="lower" name={t('forecast.band')} stroke="none" dot={false} isAnimationActive={false} />
                        </ComposedChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}

function formatMetric(key, value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    if (key === 'winRate') return `${(value * 100).toFixed(0)}%`;
    return Number(value).toFixed(2);
}