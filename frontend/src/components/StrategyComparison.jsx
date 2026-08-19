import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/apiClient';
import ChartCard from './ChartCard';
import GlossaryTooltip from './GlossaryTooltip';
import { fmtPct, fmtNumber } from '../lib/format';
import { useI18n } from '../i18n/I18nProvider';

const RANGE_OPTIONS = [30, 90, 180, 365];
const GRADE_STYLES = {
    conservative: 'text-success border-success/40 bg-success/10',
    balanced: 'text-warning border-warning/40 bg-warning/10',
    aggressive: 'text-error border-error/40 bg-error/10',
};

export default function StrategyComparison() {
    const { t, lang } = useI18n();
    const [rangeDays, setRangeDays] = useState(90);
    const [data, setData] = useState(null);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let alive = true;
        setIsLoading(true);
        setError(null);
        apiFetch(`/api/analytics/strategies?rangeDays=${rangeDays}&leverage=4`)
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then(d => {
                if (!alive) return;
                if (d.error) { setError(d.error); setData(null); return; }
                setData(d);
            })
            .catch(() => alive && setError(t('analytics.strategyCompareLoadFailed')))
            .finally(() => alive && setIsLoading(false));
        return () => { alive = false; };
    }, [rangeDays, t]);

    const rows = (data?.strategies || []).filter(s => !s.error);
    const bestSharpe = rows.length ? Math.max(...rows.map(s => s.sharpe)) : -Infinity;

    return (
        <ChartCard
            title={t('analytics.strategyCompareTitle')}
            subtitle={t('analytics.strategyCompareSubtitle')}
            icon="compare_arrows"
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
                <div className="flex items-center justify-center h-[180px] text-on-surface-variant">
                    <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>
                </div>
            ) : error ? (
                <div className="flex flex-col items-center justify-center h-[180px] text-center gap-2">
                    <span className="material-symbols-outlined text-error text-3xl">cloud_off</span>
                    <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant max-w-sm">{error}</p>
                </div>
            ) : rows.length === 0 ? (
                <div className="flex items-center justify-center h-[120px] text-on-surface-variant font-[JetBrains_Mono] text-[12px]">
                    {t('common.noData')}
                </div>
            ) : (
                <div className="overflow-x-auto -mx-1">
                    <table className="w-full min-w-[640px] border-collapse">
                        <thead>
                            <tr className="font-[JetBrains_Mono] text-[10px] uppercase tracking-wider text-on-surface-variant">
                                <th className="text-left px-2 py-2 border-b border-outline-variant">{t('analytics.strategy')}</th>
                                <th className="text-left px-2 py-2 border-b border-outline-variant">{t('analytics.riskLow')} · {t('analytics.riskHigh')}</th>
                                <th className="text-right px-2 py-2 border-b border-outline-variant">{t('analytics.currentApy')}</th>
                                <th className="text-right px-2 py-2 border-b border-outline-variant">
                                    {t('analytics.cagr')}
                                    <GlossaryTooltip term="glossary.cagr" />
                                </th>
                                <th className="text-right px-2 py-2 border-b border-outline-variant">
                                    {t('analytics.sharpe')}
                                    <GlossaryTooltip term="glossary.sharpe" />
                                </th>
                                <th className="text-right px-2 py-2 border-b border-outline-variant">
                                    {t('analytics.maxDrawdown')}
                                    <GlossaryTooltip term="glossary.maxDrawdown" />
                                </th>
                                <th className="text-right px-2 py-2 border-b border-outline-variant">{t('analytics.totalReturn')}</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map(s => {
                                const best = s.sharpe === bestSharpe && Number.isFinite(bestSharpe);
                                return (
                                    <tr key={s.strategy} className={`border-b border-outline-variant/60 ${best ? 'bg-success/5' : ''}`}>
                                        <td className="px-2 py-2.5">
                                            <p className="font-[Inter] text-[13px] font-medium text-on-surface flex items-center gap-2">
                                                {s.label}
                                                {best && (
                                                    <span className="px-1.5 py-0.5 rounded-full bg-success/15 border border-success/40 text-success text-[9px] font-[JetBrains_Mono]">
                                                        ★
                                                    </span>
                                                )}
                                            </p>
                                            <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant">{s.leverage > 1 ? `${s.leverage}x` : '1x'}</p>
                                        </td>
                                        <td className="px-2 py-2.5">
                                            <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-[JetBrains_Mono] ${GRADE_STYLES[s.riskGrade] || GRADE_STYLES.balanced}`}>
                                                {t(`analytics.riskGrade${s.riskGrade.charAt(0).toUpperCase()}${s.riskGrade.slice(1)}`)}
                                            </span>
                                        </td>
                                        <td className={`px-2 py-2.5 text-right font-[Inter] text-[13px] font-bold tabular-nums ${(s.currentNetApy ?? 0) >= 0 ? 'text-success' : 'text-error'}`}>
                                            {fmtPct(s.currentNetApy, { locale: lang, fractionDigits: 1, signed: true })}
                                        </td>
                                        <td className="px-2 py-2.5 text-right font-[Inter] text-[13px] font-semibold tabular-nums text-on-surface">{fmtPct(s.cagr, { locale: lang, fractionDigits: 1 })}</td>
                                        <td className="px-2 py-2.5 text-right font-[Inter] text-[13px] tabular-nums text-on-surface">{fmtNumber(s.sharpe, { locale: lang, fractionDigits: 2 })}</td>
                                        <td className="px-2 py-2.5 text-right font-[Inter] text-[13px] tabular-nums text-error">{fmtPct(s.maxDrawdown, { locale: lang, fractionDigits: 1, signed: true })}</td>
                                        <td className="px-2 py-2.5 text-right font-[Inter] text-[13px] tabular-nums text-on-surface">{fmtPct(s.totalReturn, { locale: lang, fractionDigits: 1, signed: true })}</td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}
        </ChartCard>
    );
}
