import { useState, useEffect } from 'react';
import {
    ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts';
import { apiFetch } from '../lib/apiClient';
import ChartCard from './ChartCard';
import { xAxis, yAxis, grid } from './chartTheme';
import { chartColors } from '../lib/chartColors';
import { fmtNumber, fmtPct } from '../lib/format';
import { useI18n } from '../i18n/I18nProvider';

const RANGE_OPTIONS = [30, 90, 180, 365];

export default function LeverageSweepPanel() {
    const { t, lang } = useI18n();
    const [rangeDays, setRangeDays] = useState(90);
    const [rows, setRows] = useState([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        setIsLoading(true);
        setError(null);
        apiFetch(`/api/backtest/sweep?rangeDays=${rangeDays}&leverages=2,3,4,5,6`)
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then(data => {
                if (!alive) return;
                setRows(Array.isArray(data) ? data.map(r => ({ leverage: r.leverage, cagr: r.cagr, sharpe: r.sharpe, maxDrawdown: r.maxDrawdown })) : []);
            })
            .catch(() => alive && setError(t('analytics.sweepLoadFailed')))
            .finally(() => alive && setIsLoading(false));
        return () => { alive = false; };
    }, [rangeDays, t]);

    const best = rows.reduce((acc, r) => (r.cagr != null && r.cagr > acc.cagr ? r : acc), { cagr: -Infinity });

    return (
        <ChartCard
            title={t('analytics.sweepTitle')}
            subtitle={t('analytics.sweepSubtitle')}
            icon="tune"
            badge={
                <select
                    value={rangeDays}
                    onChange={e => setRangeDays(Number(e.target.value))}
                    aria-label={t('analytics.rangeDays')}
                    className="bg-surface-container-lowest border border-outline-variant rounded-md px-2 py-1 text-[12px] font-[JetBrains_Mono] text-on-surface outline-none focus:border-primary"
                >
                    {RANGE_OPTIONS.map(d => <option key={d} value={d}>{d}d</option>)}
                </select>
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
                    <div className="h-[260px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                                <CartesianGrid {...grid} />
                                <XAxis {...xAxis} dataKey="leverage" tickFormatter={v => `${v}x`} type="number" domain={['dataMin', 'dataMax']} allowDecimals={false} />
                                <YAxis {...yAxis} yAxisId="left" tickFormatter={v => `${v}%`} />
                                <YAxis {...yAxis} yAxisId="right" orientation="right" domain={[0, 'auto']} allowDecimals={false} />
                                <Tooltip
                                    content={({ active, payload }) => {
                                        if (!active || !payload?.length) return null;
                                        const p = payload[0].payload;
                                        return (
                                            <div className="bg-[#161718]/95 backdrop-blur-md border border-white/10 rounded-xl p-3 shadow-2xl">
                                                <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-1">{p.leverage}x</p>
                                                <p className="font-[Inter] text-[13px] font-bold text-success tabular-nums">CAGR {fmtPct(p.cagr, { locale: lang, signed: true })}</p>
                                                <p className="font-[Inter] text-[13px] font-bold text-primary tabular-nums">Sharpe {fmtNumber(p.sharpe, { locale: lang })}</p>
                                                <p className="font-[Inter] text-[13px] font-bold text-error tabular-nums">MaxDD {fmtPct(p.maxDrawdown, { locale: lang, signed: true })}</p>
                                            </div>
                                        );
                                    }}
                                />
                                <Bar yAxisId="left" dataKey="cagr" name="CAGR" fill={chartColors.success} radius={[3, 3, 0, 0]} />
                                <Line yAxisId="right" type="monotone" dataKey="sharpe" name="Sharpe" stroke={chartColors.primary} strokeWidth={2} dot={{ r: 4 }} />
                                <Line yAxisId="right" type="monotone" dataKey="maxDrawdown" name="MaxDD" stroke={chartColors.error} strokeWidth={2} strokeDasharray="5 3" dot={{ r: 4 }} />
                            </ComposedChart>
                        </ResponsiveContainer>
                    </div>
                    {best.leverage != null && (
                        <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant">
                            {t('analytics.bestLeverage', { leverage: best.leverage, cagr: fmtPct(best.cagr, { locale: lang, signed: true }) })}
                        </p>
                    )}
                </>
            )}
        </ChartCard>
    );
}