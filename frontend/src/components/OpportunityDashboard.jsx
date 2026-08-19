import { useState, useMemo } from 'react';
import ChartCard from './ChartCard';
import { fmtPct, fmtUsdCompact } from '../lib/format';
import { useI18n } from '../i18n/I18nProvider';

// Heuristic risk premium used only to order the "risk-adjusted" view.
// Lower premium = lower risk tier; a 10% high-risk opportunity ranks below a
// 7% low-risk one, which is the whole point of showing it this way.
const RISK_PREMIUM = { low: 1, medium: 1.6, high: 2.6 };
const RISK_STYLES = {
    low: 'text-success border-success/40 bg-success/10',
    medium: 'text-warning border-warning/40 bg-warning/10',
    high: 'text-error border-error/40 bg-error/10',
};
const CAT_KEY = {
    staking: 'analytics.catStaking',
    fixedYield: 'analytics.catFixedYield',
    lending: 'analytics.catLending',
    vault: 'analytics.catVault',
    rwaCredit: 'analytics.catRwaCredit',
    deltaNeutral: 'analytics.catDeltaNeutral',
    basis: 'analytics.catBasis',
};

function trendMeta(cls) {
    if (!cls) return null;
    if (cls.includes('Up')) return { key: 'analytics.trendUp', arrow: '▲', color: 'text-success' };
    if (cls.includes('Down')) return { key: 'analytics.trendDown', arrow: '▼', color: 'text-error' };
    return { key: 'analytics.trendStable', arrow: '→', color: 'text-on-surface-variant' };
}

function RiskBadge({ tier, t }) {
    const [open, setOpen] = useState(false);
    const safeTier = ['low', 'medium', 'high'].includes(tier) ? tier : 'low';
    const cap = safeTier.charAt(0).toUpperCase() + safeTier.slice(1);
    const label = t(`analytics.risk${cap}`);
    const desc = t(`analytics.risk${cap}Desc`);
    return (
        <span className="relative inline-flex">
            <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen(o => !o)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[11px] font-[JetBrains_Mono] ${RISK_STYLES[safeTier]}`}
            >
                <span className="w-1.5 h-1.5 rounded-full bg-current" />
                {label}
            </button>
            {open && (
                <span
                    role="tooltip"
                    onClick={() => setOpen(false)}
                    className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 max-w-[calc(100vw-2rem)] bg-surface-container-high border border-outline-variant rounded-xl p-3 shadow-2xl text-left"
                >
                    <span className="block font-[Inter] text-[12px] font-semibold text-on-surface mb-1">{label} risk</span>
                    <span className="block font-[JetBrains_Mono] text-[10px] leading-relaxed text-on-surface-variant">{desc}</span>
                </span>
            )}
        </span>
    );
}

// Simple relative-width bar used for the benchmark strip.
function BenchBar({ label, value, color }) {
    const width = Math.max(2, Math.min(100, value / 15 * 100));
    return (
        <div className="flex flex-col gap-1 min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
                <span className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant truncate">{label}</span>
                <span className="font-[Inter] text-[13px] font-bold tabular-nums text-on-surface">{fmtPct(value, { fractionDigits: 1 })}</span>
            </div>
            <div className="h-2 rounded-full bg-surface-container-lowest border border-outline-variant overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${width}%`, backgroundColor: color }} />
            </div>
        </div>
    );
}

export default function OpportunityDashboard({ data, isLoading, error, onRetry }) {
    const { t, lang } = useI18n();
    const [sort, setSort] = useState('yield');
    const [riskFilter, setRiskFilter] = useState('all');
    const [stableOnly, setStableOnly] = useState(false);

    const benchmarks = data?.benchmarks || null;
    const tBillValue = benchmarks?.tBill?.value ?? 4.2;

    const ops = useMemo(() => {
        if (!data?.opportunities) return [];
        let list = data.opportunities;
        if (riskFilter !== 'all') list = list.filter(o => o.riskTier === riskFilter);
        if (stableOnly) list = list.filter(o => o.stablecoin);
        const scored = list.map(o => ({
            ...o,
            score: (o.totalApy ?? 0) / (RISK_PREMIUM[o.riskTier] || 1),
            vsTBill: (o.totalApy ?? 0) - tBillValue,
        }));
        scored.sort((a, b) => (sort === 'riskAdjusted' ? b.score - a.score : (b.totalApy ?? 0) - (a.totalApy ?? 0)));
        return scored;
    }, [data, riskFilter, stableOnly, sort, tBillValue]);

    const sortBtn = (key, labelKey) => (
        <button
            type="button"
            onClick={() => setSort(key)}
            className={`px-2.5 py-1 rounded-md text-[12px] font-[Inter] border transition-colors ${sort === key ? 'bg-primary/15 text-primary border-primary/40' : 'text-on-surface-variant border-outline-variant hover:text-on-surface'}`}
        >
            {t(labelKey)}
        </button>
    );
    const filterBtn = (key, labelKey) => (
        <button
            type="button"
            onClick={() => setRiskFilter(key)}
            className={`px-2.5 py-1 rounded-md text-[12px] font-[Inter] border transition-colors ${riskFilter === key ? 'bg-primary/15 text-primary border-primary/40' : 'text-on-surface-variant border-outline-variant hover:text-on-surface'}`}
        >
            {t(labelKey)}
        </button>
    );

    return (
        <ChartCard
            title={t('analytics.opportunitiesTitle')}
            subtitle={t('analytics.opportunitiesSubtitle')}
            icon="query_stats"
            badge={
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        type="button"
                        onClick={() => setStableOnly(s => !s)}
                        className={`px-2.5 py-1 rounded-md text-[12px] font-[Inter] border transition-colors ${stableOnly ? 'bg-primary/15 text-primary border-primary/40' : 'text-on-surface-variant border-outline-variant hover:text-on-surface'}`}
                    >
                        {t('analytics.sortByStable')}
                    </button>
                </div>
            }
        >
            <div className="flex flex-wrap items-center gap-2">
                <div className="flex flex-wrap gap-1.5">
                    {sortBtn('yield', 'analytics.sortByYield')}
                    {sortBtn('riskAdjusted', 'analytics.sortByRiskAdjusted')}
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {filterBtn('all', 'analytics.filterAll')}
                    {filterBtn('low', 'analytics.filterLow')}
                    {filterBtn('medium', 'analytics.filterMedium')}
                    {filterBtn('high', 'analytics.filterHigh')}
                </div>
            </div>

            {isLoading ? (
                <div className="flex items-center justify-center h-[220px] text-on-surface-variant">
                    <span className="material-symbols-outlined animate-spin text-primary">progress_activity</span>
                </div>
            ) : error ? (
                <div className="flex flex-col items-center justify-center h-[220px] text-center gap-3">
                    <span className="material-symbols-outlined text-error text-3xl">cloud_off</span>
                    <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant max-w-sm">{error}</p>
                    <button
                        type="button"
                        onClick={onRetry}
                        className="px-3 py-1.5 rounded-md bg-primary/15 text-primary border border-primary/40 text-[12px] font-[Inter]"
                    >
                        {t('common.retry')}
                    </button>
                </div>
            ) : (
                <>
                    {benchmarks && (
                        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 p-3 rounded-xl bg-surface-container-lowest border border-outline-variant">
                            <BenchBar label={t('analytics.tBill')} value={benchmarks.tBill?.value} color="#17c3b2" />
                            <BenchBar label={t('analytics.ethStaking')} value={benchmarks.ethStaking?.value} color="#8b5cf6" />
                            <BenchBar label={t('analytics.susdeBenchmark')} value={benchmarks.susde?.value} color="#f59e0b" />
                            <BenchBar label={t('analytics.usdcHolding')} value={0} color="#383b3f" />
                        </div>
                    )}

                    {ops.length === 0 ? (
                        <div className="flex items-center justify-center h-[120px] text-on-surface-variant font-[JetBrains_Mono] text-[12px]">
                            {t('common.noData')}
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                            {ops.map(o => {
                                const trend = trendMeta(o.prediction?.cls);
                                const positive = (o.totalApy ?? 0) >= 0;
                                return (
                                    <div key={o.id} className={`bg-surface-container-lowest border rounded-xl p-3.5 flex flex-col gap-2 min-w-0 ${o.ourStrategy ? 'border-primary/50' : 'border-outline-variant'}`}>
                                        <div className="flex items-start justify-between gap-2">
                                            <div className="min-w-0">
                                                <p className="font-[Inter] text-[13px] font-semibold text-on-surface truncate">{o.name}</p>
                                                <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant truncate">
                                                    {o.protocol} · {o.chain}
                                                </p>
                                            </div>
                                            {o.ourStrategy && (
                                                <span className="shrink-0 px-2 py-0.5 rounded-full bg-primary/15 border border-primary/40 text-primary text-[10px] font-[JetBrains_Mono]">
                                                    {t('analytics.ourStrategy')}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex items-end justify-between gap-2">
                                            <p className={`font-[Inter] text-[26px] font-bold tabular-nums leading-none ${positive ? 'text-success' : 'text-error'}`}>
                                                {fmtPct(o.totalApy, { locale: lang, fractionDigits: 1, signed: true })}
                                            </p>
                                            {o.tvlUsd ? (
                                                <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant">{fmtUsdCompact(o.tvlUsd, lang)} TVL</p>
                                            ) : null}
                                        </div>

                                        <div className="flex flex-wrap items-center gap-1.5">
                                            <RiskBadge tier={o.riskTier} t={t} />
                                            <span className="px-2 py-0.5 rounded-full bg-surface-container border border-outline-variant text-[10px] font-[JetBrains_Mono] text-on-surface-variant">
                                                {t(CAT_KEY[o.category] || o.category)}
                                            </span>
                                            {trend && (
                                                <span className={`inline-flex items-center gap-1 text-[10px] font-[JetBrains_Mono] ${trend.color}`}>
                                                    {trend.arrow} {t(trend.key)} {Number.isFinite(o.prediction.probability) ? `${Math.round(o.prediction.probability)}%` : ''}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant">
                                                {fmtPct(o.baseApy, { locale: lang, fractionDigits: 1 })} {t('analytics.baseApy')}
                                                {o.rewardApy > 0 ? ` + ${fmtPct(o.rewardApy, { locale: lang, fractionDigits: 1 })} ${t('analytics.rewardApy')}` : ''}
                                            </p>
                                            <span className={`font-[JetBrains_Mono] text-[10px] ${o.vsTBill >= 0 ? 'text-success' : 'text-error'}`}>
                                                {t('analytics.vsTBill')} {fmtPct(o.vsTBill, { locale: lang, fractionDigits: 1, signed: true })}
                                            </span>
                                        </div>

                                        {o.warning && (
                                            <p className="flex items-start gap-1.5 bg-warning/10 border border-warning/30 rounded-lg px-2.5 py-1.5 text-[11px] text-warning leading-snug">
                                                <span className="material-symbols-outlined text-[14px] shrink-0">warning</span>
                                                {t(`analytics.warning${o.warning.charAt(0).toUpperCase()}${o.warning.slice(1)}`)}
                                            </p>
                                        )}

                                        {o.sourceUrl && (
                                            <a
                                                href={o.sourceUrl}
                                                target="_blank"
                                                rel="noreferrer"
                                                className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant hover:text-primary underline-offset-2 hover:underline"
                                            >
                                                {o.source} ↗
                                            </a>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </>
            )}
        </ChartCard>
    );
}
