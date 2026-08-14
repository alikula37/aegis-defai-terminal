import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useWebSocket } from '../contexts/WebSocketContext';

const COLORS = ['#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444'];

export default function PortfolioAllocationChart() {
    const { portfolioData } = useWebSocket();
    const strategies = portfolioData?.strategies || [];

    if (strategies.length === 0) {
        return (
            <div className="bg-surface-container border border-outline-variant rounded-xl p-5 flex flex-col h-full min-h-[300px] items-center justify-center">
                <p className="text-on-surface-variant font-[JetBrains_Mono] text-[13px]">No strategy data available.</p>
            </div>
        );
    }

    const data = strategies.map(s => ({
        name: s.name,
        value: s.tvl,
        apy: s.apy
    }));

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            const total = strategies.reduce((sum, s) => sum + s.tvl, 0);
            const percent = total > 0 ? ((data.value / total) * 100).toFixed(1) : 0;
            return (
                <div className="bg-surface-container-high border border-outline-variant p-3 rounded-lg shadow-xl">
                    <p className="text-on-surface font-bold text-[13px] mb-1">{data.name}</p>
                    <p className="text-on-surface-variant text-[12px] font-[JetBrains_Mono]">
                        TVL: ${data.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-on-surface-variant text-[12px] font-[JetBrains_Mono]">
                        Allocation: {percent}%
                    </p>
                    <p className="text-primary text-[12px] font-[JetBrains_Mono]">
                        APY: {data.apy.toFixed(2)}%
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <div className="bg-surface-container border border-outline-variant rounded-xl p-5 flex flex-col h-full">
            <h3 className="font-[Inter] text-[16px] font-semibold text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-[20px] text-primary">pie_chart</span>
                Portfolio Allocation
            </h3>
            <div className="flex-1 min-h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius={60}
                            outerRadius={80}
                            paddingAngle={5}
                            dataKey="value"
                            stroke="none"
                        >
                            {data.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                            ))}
                        </Pie>
                        <Tooltip content={<CustomTooltip />} />
                        <Legend
                            verticalAlign="bottom"
                            height={36}
                            iconType="circle"
                            wrapperStyle={{ fontSize: '12px', fontFamily: 'Inter', color: 'var(--color-on-surface-variant)' }}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
