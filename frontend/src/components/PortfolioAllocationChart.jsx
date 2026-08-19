import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useI18n } from '../i18n/I18nProvider';

const COLORS = ['#17c3b2', '#27a644', '#8b5cf6', '#f5a623', '#eb5757'];

export default function PortfolioAllocationChart() {
    const { t } = useI18n();
    const { portfolioData } = useWebSocket();
    const strategies = portfolioData?.strategies || [];

    if (strategies.length === 0) {
        return (
            <div className="bg-surface-container border border-outline-variant rounded-xl p-5 flex flex-col h-full min-h-[300px] items-center justify-center">
                <p className="text-on-surface-variant font-[JetBrains_Mono] text-[13px]">{t('alloc.noData')}</p>
            </div>
        );
    }

    const data = strategies.map(s => ({
        name: s.name,
        value: Number.isFinite(Number(s.tvl)) ? Number(s.tvl) : 0,
        apy: Number.isFinite(Number(s.apy)) ? Number(s.apy) : 0
    }));

    const CustomTooltip = ({ active, payload }) => {
        if (active && payload && payload.length) {
            const data = payload[0].payload;
            const total = strategies.reduce((sum, s) => sum + Number(s.tvl || 0), 0);
            const percent = total > 0 ? ((data.value / total) * 100).toFixed(1) : 0;
            return (
                <div className="bg-surface-container-high border border-outline-variant p-3 rounded-lg shadow-xl">
                    <p className="text-on-surface font-bold text-[13px] mb-1">{data.name}</p>
                    <p className="text-on-surface-variant text-[12px] font-[JetBrains_Mono]">
                        {t('alloc.tvl')} ${data.value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </p>
                    <p className="text-on-surface-variant text-[12px] font-[JetBrains_Mono]">
                        {t('alloc.allocation')} {percent}%
                    </p>
                    <p className="text-primary text-[12px] font-[JetBrains_Mono]">
                        {t('alloc.apy')} {data.apy.toFixed(2)}%
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
                {t('alloc.portfolioAllocation')}
            </h3>
            <div className="flex-1 min-h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                        <Pie
                            data={data}
                            cx="50%"
                            cy="50%"
                            innerRadius="45%"
                            outerRadius="75%"
                            paddingAngle={4}
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
                            wrapperStyle={{ fontSize: '12px', fontFamily: 'Inter', color: 'var(--color-on-surface-variant)', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '0 12px' }}
                        />
                    </PieChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
