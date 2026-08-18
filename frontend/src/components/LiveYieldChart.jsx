import { apiFetch } from '../lib/apiClient';
import { useState, useEffect, useRef } from 'react';
import {
    ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer, ReferenceLine
} from 'recharts';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useI18n } from '../i18n/I18nProvider';

// ---- Helpers ----
function fmtTime(iso) {
    const d = new Date(iso);
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function rowToPoint(row) {
    const o = row.oracle || {};
    return {
        time: fmtTime(row.timestamp),
        timestamp: row.timestamp,
        netApy: Number((row.net_apy || 0).toFixed(2)),
        pendleApy: Number((o.pendlePtSusdeApy || 0).toFixed(2)),
        morphoBorrow: Number((o.morphoBorrowApy || 0).toFixed(2)),
        spread: Number((o.baseSpread || 0).toFixed(2)),
        tvl: Number((row.tvl || 0).toFixed(2)),
    };
}

// ---- Custom Premium Tooltip ----
const CustomTooltip = ({ active, payload, label, tvlLabel }) => {
    if (!active || !payload || !payload.length) return null;
    const d = payload[0]?.payload || {};
    return (
        <div className="bg-[#161718]/95 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-2xl min-w-[200px]">
            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-3 border-b border-white/10 pb-2">
                {label}
            </p>
            {payload.map((entry) => (
                <div key={entry.dataKey} className="flex justify-between items-center gap-6 mb-1.5">
                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                        {entry.name}
                    </span>
                    <span className="font-[Inter] text-[13px] font-bold" style={{ color: entry.color }}>
                        {entry.value > 0 ? '+' : ''}{entry.value}%
                    </span>
                </div>
            ))}
            {d.tvl > 0 && (
                <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant mt-2 pt-2 border-t border-white/10">
                    {tvlLabel}: ${Number(d.tvl).toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </p>
            )}
        </div>
    );
};

// ---- Legend item ----
const ChartLegend = ({ series }) => {
    const { t } = useI18n();
    return (
        <div className="flex flex-wrap gap-x-5 gap-y-1 mt-1">
            {series.map(s => (
                <span key={s.key} className="flex items-center gap-1.5 font-[JetBrains_Mono] text-[11px] text-on-surface-variant">
                    <span className="w-3 h-0.5 inline-block rounded" style={{ backgroundColor: s.color }}></span>
                    {t(s.labelKey)}
                </span>
            ))}
        </div>
    );
};

const SERIES = [
    { key: 'netApy', labelKey: 'chart.netApyLeveraged', color: '#17c3b2' },
    { key: 'pendleApy', labelKey: 'chart.pendleFixed', color: '#27a644' },
    { key: 'morphoBorrow', labelKey: 'chart.morphoBorrow', color: '#eb5757' },
];

const MAX_POINTS = 1000; // Keep up to 1000 data points in memory

export default function LiveYieldChart() {
    const { t } = useI18n();
    const { portfolioData: liveData, isSimulationRunning } = useWebSocket();
    const [data, setData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [timeRange, setTimeRange] = useState('1H');
    const seenTimestamps = useRef(new Set());

    // ---- Load DB history on mount and when timeRange changes ----
    useEffect(() => {
        setIsLoading(true);
        setLoadError(null);
        apiFetch(`/api/portfolio/history?limit=1000&timeRange=${timeRange}`)
            .then(r => r.json())
            .then(rows => {
                // Keep negative-APY rows (real losses must show in the chart);
                // only skip null/zero-value rows.
                const pts = (Array.isArray(rows) ? rows : [])
                    .filter(r => r.net_apy != null && r.net_apy !== 0)
                    .map(rowToPoint)
                    .reverse(); // Reverse to show oldest to newest

                seenTimestamps.current.clear();
                pts.forEach(p => seenTimestamps.current.add(p.timestamp));
                setData(pts);
            })
            .catch(() => {
                // Live WS data will still fill the chart, but the failure must
                // not masquerade as "no data".
                setLoadError(t('toast.historyUnavailable'));
            })
            .finally(() => setIsLoading(false));
    }, [timeRange, t]);

    // ---- Append live cycle data ----
    useEffect(() => {
        if (!liveData || !liveData.netApy || liveData.netApy === 0) return;

        // Build a synthetic row from the live WebSocket payload
        const syntheticRow = {
            timestamp: new Date().toISOString(),
            net_apy: liveData.netApy,
            tvl: liveData.tvl,
            oracle: {
                pendlePtSusdeApy: liveData.pendlePtSusdeApy,
                morphoBorrowApy: liveData.morphoBorrowApy,
                baseSpread: liveData.baseSpread,
            },
        };

        const pt = rowToPoint(syntheticRow);

        setData(prev => {
            // Avoid duplicate timestamps within the same minute
            const lastPt = prev[prev.length - 1];
            if (lastPt && lastPt.time === pt.time) {
                // Update the existing point in-place
                return [...prev.slice(0, -1), { ...lastPt, ...pt }];
            }
            const next = [...prev, pt];
            return next.length > MAX_POINTS ? next.slice(-MAX_POINTS) : next;
        });
    }, [liveData]);

    const hasData = data.length > 0;

    // Dynamic Y domain: from 0 to max(all series) + 5
    const allVals = data.flatMap(d => [d.netApy, d.pendleApy, d.morphoBorrow]);
    const yMax = allVals.length ? Math.ceil(Math.max(...allVals) / 5) * 5 + 5 : 50;
    const yMin = Math.min(0, ...(data.map(d => d.morphoBorrow)));

    return (
        <div className="bg-surface-container border border-outline-variant rounded-xl p-[1.5rem] flex flex-col h-[380px] relative overflow-hidden">
            {/* Header */}
            <div className="flex justify-between items-start mb-3 relative z-10">
                <div>
                    <h3 className="font-[Inter] text-[16px] leading-[24px] font-semibold text-on-surface">
                        {t('chart.title')}
                    </h3>
                    <p className="font-[JetBrains_Mono] text-[11px] leading-[16px] text-on-surface-variant mt-0.5">
                        {t('chart.subtitle')}
                    </p>
                    <ChartLegend series={SERIES} />
                </div>
                <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="flex items-center gap-2 bg-surface-container-lowest px-3 py-1.5 rounded-full border border-outline-variant/50">
                        <span className={`w-2 h-2 rounded-full ${hasData ? 'bg-primary animate-pulse' : 'bg-on-surface-variant'}`}></span>
                        <span className="font-[JetBrains_Mono] text-[11px] font-bold text-primary tracking-wider">
                            {isLoading ? t('chart.loading') : hasData ? t('chart.live') : t('chart.waiting')}
                        </span>
                    </div>
                    <div className="flex gap-1 bg-surface-container-lowest rounded-lg p-1 border border-outline-variant/30">
                        {['1H', '24H', '7D', 'ALL'].map(range => (
                            <button
                                key={range}
                                onClick={() => setTimeRange(range)}
                                className={`px-2.5 py-1 rounded text-[10px] font-[JetBrains_Mono] font-bold transition-colors ${timeRange === range
                                        ? 'bg-primary/20 text-primary'
                                        : 'text-on-surface-variant hover:text-on-surface hover:bg-white/5'
                                    }`}
                            >
                                {range}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Chart or empty state */}
            <div className="flex-1 w-full relative z-10 -ml-4">
                {!hasData ? (
                    <div className="flex flex-col items-center justify-center h-full gap-3 text-on-surface-variant">
                        <span className={`material-symbols-outlined text-[40px] ${loadError ? 'text-error opacity-70' : 'opacity-30'}`}>show_chart</span>
                        <p className="font-[JetBrains_Mono] text-[12px] text-center opacity-50 max-w-[220px]">
                            {isLoading
                                ? t('chart.loadingHistory')
                                : loadError
                                    ? loadError
                                    : isSimulationRunning
                                        ? t('chart.waitingData')
                                        : t('chart.noData')}
                        </p>
                    </div>
                ) : (
                    <ResponsiveContainer width="100%" height="100%">
                        <ComposedChart data={data} margin={{ top: 8, right: 10, left: 0, bottom: 0 }}>
                            <defs>
                                <linearGradient id="gradNet" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#17c3b2" stopOpacity={0.3} />
                                    <stop offset="95%" stopColor="#17c3b2" stopOpacity={0} />
                                </linearGradient>
                                <filter id="glow">
                                    <feGaussianBlur stdDeviation="3" result="blur" />
                                    <feComposite in="SourceGraphic" in2="blur" operator="over" />
                                </filter>
                            </defs>
                            <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="#23252a"
                                opacity={0.2}
                                vertical={false}
                            />
                            <XAxis
                                dataKey="time"
                                stroke="#383b3f"
                                fontSize={10}
                                fontFamily="JetBrains Mono"
                                tickLine={false}
                                axisLine={false}
                                tickMargin={10}
                                minTickGap={30}
                            />
                            <YAxis
                                stroke="#383b3f"
                                fontSize={10}
                                fontFamily="JetBrains Mono"
                                tickFormatter={v => `${v}%`}
                                domain={[Math.floor(yMin), yMax]}
                                tickLine={false}
                                axisLine={false}
                                tickMargin={8}
                                width={42}
                            />
                            <Tooltip content={<CustomTooltip tvlLabel={t('chart.tvlLabel')} />} cursor={{ stroke: '#17c3b2', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.4 }} />

                            {/* Zero reference line */}
                            <ReferenceLine y={0} stroke="#383b3f" strokeDasharray="4 4" opacity={0.4} />

                            {/* Net APY — primary area */}
                            <Area
                                type="monotone"
                                dataKey="netApy"
                                name={t('chart.netApyLeveraged')}
                                stroke="#17c3b2"
                                strokeWidth={2.5}
                                fill="url(#gradNet)"
                                isAnimationActive={false}
                                filter="url(#glow)"
                                dot={false}
                                activeDot={{ r: 5, fill: '#17c3b2', stroke: '#0f1011', strokeWidth: 2 }}
                            />
                            {/* Pendle fixed APY */}
                            <Line
                                type="monotone"
                                dataKey="pendleApy"
                                name={t('chart.pendleFixed')}
                                stroke="#27a644"
                                strokeWidth={1.5}
                                strokeDasharray="6 3"
                                isAnimationActive={false}
                                dot={false}
                                activeDot={{ r: 4, fill: '#27a644', stroke: '#0f1011', strokeWidth: 2 }}
                            />
                            {/* Morpho borrow cost */}
                            <Line
                                type="monotone"
                                dataKey="morphoBorrow"
                                name={t('chart.morphoBorrow')}
                                stroke="#eb5757"
                                strokeWidth={1.5}
                                strokeDasharray="3 3"
                                isAnimationActive={false}
                                dot={false}
                                activeDot={{ r: 4, fill: '#eb5757', stroke: '#0f1011', strokeWidth: 2 }}
                            />
                        </ComposedChart>
                    </ResponsiveContainer>
                )}
            </div>
        </div>
    );
}
