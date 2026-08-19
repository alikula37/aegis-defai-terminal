import { useState, useEffect, useMemo } from 'react';
import { fetchJson } from '../lib/apiClient';
import { chartColors } from '../lib/chartColors';
import GlossaryTooltip from './GlossaryTooltip';
import ChartCard from './ChartCard';
import { xAxis, yAxis, grid, tooltipCursor } from './chartTheme';
import { fmtPct, fmtUsdCompact, fmtUsd } from '../lib/format';
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

const METRIC_TABS = [
    { value: 'netApy', labelKey: 'forecast.tabNetApy' },
    { value: 'tvl', labelKey: 'forecast.tabTvl' },
];

export default function ForecastChart() {
    const { t, lang } = useI18n();
    const [metric, setMetric] = useState('netApy');
    const [metrics, setMetrics] = useState(null);
    const [forecast, setForecast] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        Promise.all([
            fetchJson('/api/portfolio/metrics').catch(() => null),
            fetchJson(`/api/forecast/${metric}?horizon=12`).catch(() => null),
        ])
            .then(([m, f]) => {
                if (!alive) return;
                setMetrics(m);
                setForecast(f);
                setError(f ? null : t('forecast.loadFailed'));
            })
            .catch(() => alive && setError(t('forecast.loadFailed')));
        return () => { alive = false; };
    }, [t, metric]);

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

    const isTvl = metric === 'tvl';

    const formatValue = (v) => isTvl
        ? fmtUsd(v, { locale: lang })
        : fmtPct(v, { locale: lang, signed: true });

    const CustomTooltip = ({ active, payload, label }) => {
        if (!active || !payload || !payload.length) return null;
        const p = payload[0].payload;
        return (
            <div className="bg-[#161718]/95 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-2xl min-w-[160px]">
                <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-2 pb-2 border-b border-white/10">
                    {label}
                </p>
                {p.actual != null && (
                    <p className="flex justify-between gap-4 text-[12px]">
                        <span className="text-on-surface-variant">{t('forecast.actual')}</span>
                        <span className="font-mono text-on-surface font-bold tabular-nums">{formatValue(p.actual)}</span>
                    </p>
                )}
                {p.fitted != null && (
                    <p className="flex justify-between gap-4 text-[12px] mt-1">
                        <span className="text-on-surface-variant">{t('forecast.point')}</span>
                        <span className="font-mono text-primary font-bold tabular-nums">{formatValue(p.fitted)}</span>
                    </p>
                )}
                {p.upper != null && (
                    <p className="flex justify-between gap-4 text-[11px] mt-1">
                        <span className="text-on-surface-variant">{t('forecast.band')}</span>
                        <span className="font-mono text-on-surface-variant tabular-nums">{formatValue(p.lower)} … {formatValue(p.upper)}</span>
                    </p>
                )}
            </div>
        );
    };

    const hasData = data.length > 0 && forecast?.fitted?.length > 0;

    return (
        <ChartCard
            title={t('forecast.title')}
            subtitle={t('forecast.subtitle')}
            icon="monitoring"
            glossary="glossary.forecast"
            badge={
                <div className="flex flex-wrap items-center gap-2">
                    {metrics && metrics.periods > 0 && (
                        <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant bg-surface-container-lowest px-2 py-1 rounded-full border border-outline-variant">
                            {t('forecast.samples', { n: metrics.periods })}
                        </span>
                    )}
                    <div className="flex gap-1 bg-surface-container-lowest rounded-lg p-1 border border-outline-variant/30">
                        {METRIC_TABS.map(tab => (
                            <button
                                key={tab.value}
                                onClick={() => setMetric(tab.value)}
                                className={`px-2.5 py-1 rounded text-[10px] font-[JetBrains_Mono] font-bold transition-colors ${metric === tab.value
                                        ? 'bg-primary/20 text-primary'
                                        : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
                                    }`}
                            >
                                {t(tab.labelKey)}
                            </button>
                        ))}
                    </div>
                </div>
            }
        >
            {/* Risk metric strip */}
            <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                {METRIC_KEYS.map(m => (
                    <div key={m.key} className="bg-surface-container-lowest border border-outline-variant rounded-lg p-2.5 min-w-0">
                        <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant uppercase tracking-wider flex items-center gap-1">
                            {t(`forecast.${m.key}`)}
                            {m.glossary && <GlossaryTooltip term={m.glossary} />}
                        </p>
                        <p className="font-[Inter] text-[16px] font-bold text-on-surface mt-1 tabular-nums">
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
                        <ComposedChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="gradForecastBand" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor={chartColors.tertiary} stopOpacity={0.25} />
                                    <stop offset="95%" stopColor={chartColors.tertiary} stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid {...grid} />
                            <XAxis {...xAxis} dataKey="time" />
                            <YAxis
                                {...yAxis}
                                tickFormatter={isTvl ? v => fmtUsdCompact(v, lang) : v => `${v}%`}
                                domain={['auto', 'auto']}
                            />
                            <Tooltip content={<CustomTooltip />} cursor={tooltipCursor} />
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
        </ChartCard>
    );
}

function formatMetric(key, value) {
    if (value == null || !Number.isFinite(Number(value))) return '—';
    if (key === 'winRate') return `${(value * 100).toFixed(0)}%`;
    return Number(value).toFixed(2);
}