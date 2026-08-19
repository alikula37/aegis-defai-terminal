import { useMemo } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useI18n } from '../i18n/I18nProvider';
import { chartColors } from '../lib/chartColors';
import { xAxis, yAxis, grid, tooltipCursor } from './chartTheme';
import { fmtUsd, fmtUsdCompact } from '../lib/format';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

export default function TvlProjectionChart() {
    const { t, lang } = useI18n();
    const { portfolioData: liveData } = useWebSocket();

    const projectionData = useMemo(() => {
        if (!liveData || !liveData.tvl || !liveData.netApy) return [];

        const currentTvl = Number(liveData.tvl);
        const netApy = Number(liveData.netApy);
        const dailyRate = (netApy / 100) / 365;

        const calculateFutureTvl = (days) => currentTvl * Math.pow(1 + dailyRate, days);

        return [
            { time: 'Now', tvl: currentTvl, days: 0 },
            { time: '+1 Day', tvl: calculateFutureTvl(1), days: 1 },
            { time: '+7 Days', tvl: calculateFutureTvl(7), days: 7 },
            { time: '+30 Days', tvl: calculateFutureTvl(30), days: 30 },
            { time: '+90 Days', tvl: calculateFutureTvl(90), days: 90 },
            { time: '+1 Year', tvl: calculateFutureTvl(365), days: 365 },
        ];
    }, [liveData]);

    if (!liveData || !liveData.tvl) return null;

    const currentTvl = Number(liveData.tvl);
    const projected1YearTvl = projectionData.length > 0 ? projectionData[projectionData.length - 1].tvl : currentTvl;
    const projected1YearYield = projected1YearTvl - currentTvl;

    const CustomTooltip = ({ active, payload, _label }) => {
        if (!active || !payload || !payload.length) return null;
        const data = payload[0].payload;
        return (
            <div className="bg-[#161718]/95 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-2xl min-w-[200px]">
                <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-2 pb-2 border-b border-white/10">
                    {data.time}
                </p>
                <div className="flex justify-between items-center gap-4">
                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">{t('tvl.projectedTvl')}</span>
                    <span className="font-[Inter] text-[13px] font-bold text-primary tabular-nums">
                        {fmtUsd(data.tvl, { locale: lang })}
                    </span>
                </div>
                <div className="flex justify-between items-center gap-4 mt-1">
                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">{t('tvl.estProfit')}</span>
                    <span className="font-[Inter] text-[13px] font-bold text-success tabular-nums">
                        {fmtUsd(data.tvl - currentTvl, { locale: lang })}
                    </span>
                </div>
            </div>
        );
    };

    return (
        <div className="bg-surface-container border border-outline-variant rounded-xl p-6 flex flex-col h-full">
            <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
                <div className="min-w-0">
                    <h3 className="font-[Inter] text-[16px] font-semibold text-on-surface flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary">trending_up</span>
                        {t('tvl.projectionTitle')}
                    </h3>
                    <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant mt-1">
                        {t('tvl.basedOnNetApy', { apy: Number(liveData.netApy).toFixed(2) })}
                    </p>
                </div>
                <div className="text-left sm:text-right shrink-0">
                    <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">{t('tvl.projected1y')}</p>
                    <p className="font-[Inter] text-[20px] font-bold text-success tabular-nums">
                        {fmtUsd(projected1YearYield, { locale: lang })}
                    </p>
                </div>
            </div>

            <div className="flex-1 min-h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={projectionData} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorTvl" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={chartColors.primary} stopOpacity={0.3} />
                                <stop offset="95%" stopColor={chartColors.primary} stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid {...grid} />
                        <XAxis {...xAxis} dataKey="time" />
                        <YAxis
                            {...yAxis}
                            tickFormatter={v => fmtUsdCompact(v, lang)}
                            domain={['dataMin', 'dataMax']}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={tooltipCursor} />
                        <Area
                            type="monotone"
                            dataKey="tvl"
                            stroke={chartColors.primary}
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorTvl)"
                            isAnimationActive={false}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-on-surface-variant font-[JetBrains_Mono]">
                <span className="material-symbols-outlined text-[13px] align-text-bottom mr-1">info</span>
                {t('tvl.assumptions')}
            </p>
        </div>
    );
}
