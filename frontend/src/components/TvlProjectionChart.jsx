import { useMemo } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer
} from 'recharts';

export default function TvlProjectionChart() {
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
            <div className="bg-[#1a1d1e]/95 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-2xl min-w-[200px]">
                <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-2 pb-2 border-b border-white/10">
                    {data.time}
                </p>
                <div className="flex justify-between items-center gap-4">
                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">Projected TVL:</span>
                    <span className="font-[Inter] text-[13px] font-bold text-primary">
                        ${data.tvl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                </div>
                <div className="flex justify-between items-center gap-4 mt-1">
                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">Est. Profit:</span>
                    <span className="font-[Inter] text-[13px] font-bold text-green-400">
                        +${(data.tvl - currentTvl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                </div>
            </div>
        );
    };

    return (
        <div className="bg-surface-container border border-outline-variant rounded-xl p-6 flex flex-col h-full">
            <div className="flex justify-between items-start mb-6">
                <div>
                    <h3 className="font-[Inter] text-[16px] font-semibold text-on-surface flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary">trending_up</span>
                        TVL Growth Projection
                    </h3>
                    <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant mt-1">
                        Based on current Net APY ({Number(liveData.netApy).toFixed(2)}%)
                    </p>
                </div>
                <div className="text-right">
                    <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Projected 1-Year Yield</p>
                    <p className="font-[Inter] text-[20px] font-bold text-green-400">
                        +${projected1YearYield.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                </div>
            </div>

            <div className="flex-1 min-h-[250px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={projectionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorTvl" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#8ab4f8" stopOpacity={0.3} />
                                <stop offset="95%" stopColor="#8ab4f8" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                        <XAxis dataKey="time" stroke="#ffffff40" fontSize={10} tickLine={false} axisLine={false} />
                        <YAxis
                            stroke="#ffffff40"
                            fontSize={10}
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                            domain={['dataMin', 'dataMax']}
                        />
                        <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#ffffff20', strokeWidth: 1, strokeDasharray: '3 3' }} />
                        <Area
                            type="monotone"
                            dataKey="tvl"
                            stroke="#8ab4f8"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#colorTvl)"
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
