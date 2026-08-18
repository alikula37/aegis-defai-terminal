import { apiFetch } from '../lib/apiClient';
import { useModalA11y } from '../hooks/useModalA11y';
import { useI18n } from '../i18n/I18nProvider';
import { useState, useEffect } from 'react';
import {
    AreaChart, Area, XAxis, YAxis, CartesianGrid,
    Tooltip, ResponsiveContainer
} from 'recharts';

function fmtTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '--:--';
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload || !payload.length) return null;
    const tvl = payload[0].value;
    return (
        <div className="bg-[#161718]/95 backdrop-blur-md border border-white/10 rounded-xl p-4 shadow-2xl min-w-[150px]">
            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-2 pb-2 border-b border-white/10">
                {label}
            </p>
            <p className="font-[Inter] text-[14px] font-bold text-primary">
                ${Number(tvl).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
        </div>
    );
};

export default function TvlHistoryModal({ isOpen, onClose }) {
    const { t } = useI18n();
    const { modalRef } = useModalA11y({ isOpen, onClose });
    const [data, setData] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadError, setLoadError] = useState(null);

    useEffect(() => {
        if (!isOpen) return;

        setIsLoading(true);
        setLoadError(null);
        apiFetch('/api/portfolio/history?limit=50')
            .then(r => r.json())
            .then(rows => {
                const pts = (Array.isArray(rows) ? rows : [])
                    .filter(r => r.tvl > 0)
                    .map(row => ({
                        time: fmtTime(row.timestamp),
                        tvl: Number((row.tvl || 0).toFixed(2)),
                    }));
                setData(pts);
            })
            .catch(err => {
                console.error('Failed to fetch TVL history:', err);
                setLoadError(t('tvl.loadFailed'));
            })
            .finally(() => setIsLoading(false));
    }, [isOpen, t]);

    if (!isOpen) return null;

    return (
        <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="tvl-modal-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-surface-container border border-outline-variant rounded-xl p-6 w-full max-w-2xl shadow-2xl relative">
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface transition-colors"
                >
                    <span className="material-symbols-outlined">close</span>
                </button>

                <h2 id="tvl-modal-title" className="font-[Inter] text-[20px] font-semibold text-on-surface mb-6 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">account_balance</span>
                    {t('tvl.title')}
                </h2>

                <div className="h-[300px] w-full">
                    {isLoading ? (
                        <div className="w-full h-full flex items-center justify-center">
                            <span className="material-symbols-outlined animate-spin text-primary text-3xl">progress_activity</span>
                        </div>
                    ) : loadError ? (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-3 text-on-surface-variant font-[JetBrains_Mono] text-sm text-center px-6">
                            <span className="material-symbols-outlined text-error text-3xl">cloud_off</span>
                            {loadError}
                        </div>
                    ) : data.length === 0 ? (
                        <div className="w-full h-full flex items-center justify-center text-on-surface-variant font-[JetBrains_Mono] text-sm">
                            {t('tvl.noData')}
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                <defs>
                                    <linearGradient id="gradTvlHistory" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#17c3b2" stopOpacity={0.3} />
                                        <stop offset="95%" stopColor="#17c3b2" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" vertical={false} />
                                <XAxis
                                    dataKey="time"
                                    stroke="#ffffff40"
                                    fontSize={10}
                                    tickMargin={10}
                                    tickLine={false}
                                    axisLine={false}
                                />
                                <YAxis
                                    stroke="#ffffff40"
                                    fontSize={10}
                                    tickFormatter={(val) => `$${(val / 1000).toFixed(0)}k`}
                                    tickLine={false}
                                    axisLine={false}
                                    domain={['auto', 'auto']}
                                />
                                <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#ffffff20', strokeWidth: 1, strokeDasharray: '3 3' }} />
                                <Area
                                    type="monotone"
                                    dataKey="tvl"
                                    stroke="#17c3b2"
                                    strokeWidth={2}
                                    fillOpacity={1}
                                    fill="url(#gradTvlHistory)"
                                    isAnimationActive={false}
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </div>
        </div>
    );
}
