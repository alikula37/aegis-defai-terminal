import ChartCard from './ChartCard';
import { fmtPct } from '../lib/format';
import { useI18n } from '../i18n/I18nProvider';

// Forward-looking signals: DefiLlama's ML prediction on the sUSDe pool plus the
// realized funding trend (7d average). Helps an end user see "where is this
// heading" without reading a paper.
export default function MarketOutlook({ data }) {
    const { t, lang } = useI18n();
    const market = data?.market || {};
    const susde = (data?.opportunities || []).find(o => o.id === 'susde-stake');
    const funding = (data?.opportunities || []).find(o => o.id === 'funding-basis');

    const pred = susde?.prediction;
    const trend = pred
        ? pred.cls.includes('Up') ? 'up' : pred.cls.includes('Down') ? 'down' : 'stable'
        : null;
    const trendColor = trend === 'up' ? 'text-success' : trend === 'down' ? 'text-error' : 'text-on-surface-variant';
    const arrow = trend === 'up' ? '▲' : trend === 'down' ? '▼' : '→';
    const fundingApy = market.fundingApy;
    const fundingTrend = funding?.trendApy7d;

    return (
        <ChartCard
            title={t('analytics.outlookTitle')}
            subtitle={t('analytics.outlookSubtitle')}
            icon="insights"
        >
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-3.5">
                    <p className="font-[JetBrains_Mono] text-[10px] uppercase tracking-wider text-on-surface-variant">{t('analytics.outlookSusdePrediction')}</p>
                    <p className={`font-[Inter] text-[18px] font-bold mt-1 tabular-nums ${trendColor}`}>
                        {trend ? `${arrow} ${t(`analytics.trend${trend.charAt(0).toUpperCase()}${trend.slice(1)}`)}` : t('analytics.outlookN/A')}
                    </p>
                    {pred?.probability != null && Number.isFinite(Number(pred.probability)) && (
                        <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-1">{Math.round(pred.probability)}% · {fmtPct(market.susdeApy, { locale: lang, fractionDigits: 1 })}</p>
                    )}
                </div>

                <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-3.5">
                    <p className="font-[JetBrains_Mono] text-[10px] uppercase tracking-wider text-on-surface-variant">{t('analytics.outlookFunding7d')}</p>
                    <p className={`font-[Inter] text-[18px] font-bold mt-1 tabular-nums ${(fundingTrend ?? 0) >= 0 ? 'text-success' : 'text-error'}`}>
                        {fundingTrend != null ? fmtPct(fundingTrend, { locale: lang, fractionDigits: 1, signed: true }) : t('analytics.outlookN/A')}
                    </p>
                    <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-1">
                        {t('analytics.currentApy')} {fmtPct(fundingApy, { locale: lang, fractionDigits: 1, signed: true })}
                    </p>
                </div>

                <div className="bg-surface-container-lowest border border-outline-variant rounded-xl p-3.5">
                    <p className="font-[JetBrains_Mono] text-[10px] uppercase tracking-wider text-on-surface-variant">{t('analytics.scenarioNetApy')}</p>
                    <p className={`font-[Inter] text-[18px] font-bold mt-1 tabular-nums ${(market.loopNetApy ?? 0) >= 0 ? 'text-success' : 'text-error'}`}>
                        {fmtPct(market.loopNetApy, { locale: lang, fractionDigits: 1, signed: true })}
                    </p>
                    <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-1">
                        {t('analytics.scenarioSusde')} {fmtPct(market.susdeApy, { locale: lang, fractionDigits: 1 })} · {t('analytics.scenarioBorrow')} {fmtPct(market.morphoBorrowApy, { locale: lang, fractionDigits: 1 })}
                    </p>
                </div>
            </div>
        </ChartCard>
    );
}
