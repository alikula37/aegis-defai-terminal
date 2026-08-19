import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/apiClient';
import OpportunityDashboard from '../components/OpportunityDashboard';
import MarketOutlook from '../components/MarketOutlook';
import StrategyComparison from '../components/StrategyComparison';
import ScenarioPanel from '../components/ScenarioPanel';
import BacktestPanel from '../components/BacktestPanel';
import MonteCarloPanel from '../components/MonteCarloPanel';
import LeverageSweepPanel from '../components/LeverageSweepPanel';
import LiveRiskPanel from '../components/LiveRiskPanel';
import { useI18n } from '../i18n/I18nProvider';

export default function Analytics() {
    const { t } = useI18n();
    const [oppData, setOppData] = useState(null);
    const [oppLoading, setOppLoading] = useState(true);
    const [oppError, setOppError] = useState(null);

    const loadOpps = useCallback(() => {
        setOppLoading(true);
        setOppError(null);
        apiFetch('/api/analytics/opportunities')
            .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
            .then(d => { if (d.error) { setOppError(d.error); setOppData(null); } else setOppData(d); })
            .catch(() => setOppError(t('analytics.opportunitiesLoadFailed')))
            .finally(() => setOppLoading(false));
    }, [t]);

    useEffect(() => { loadOpps(); }, [loadOpps]);

    return (
        <div className="flex-1 overflow-y-auto p-[1.5rem] bg-background">
            <div className="max-w-[1400px] mx-auto flex flex-col gap-[1rem]">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="font-[Inter] text-[24px] font-semibold text-on-surface">
                            {t('analytics.title')}
                        </h2>
                        <p className="text-[14px] text-on-surface-variant mt-1 max-w-[720px]">{t('analytics.subtitle')}</p>
                    </div>
                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant bg-surface-container border border-outline-variant px-3 py-1.5 rounded-full">
                        {t('analytics.poweredBy')}
                    </span>
                </div>

                {/* Forward-looking signals + opportunities (hero) */}
                <MarketOutlook data={oppData} />
                <OpportunityDashboard data={oppData} isLoading={oppLoading} error={oppError} onRetry={loadOpps} />

                {/* Rate scenarios + strategy comparison */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-[1rem] items-start">
                    <ScenarioPanel market={oppData?.market} />
                    <StrategyComparison />
                </div>

                {/* Deep-dive panels */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-[1rem] items-start">
                    <BacktestPanel />
                    <MonteCarloPanel />
                </div>
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-[1rem] items-start">
                    <LeverageSweepPanel />
                    <LiveRiskPanel />
                </div>
            </div>
        </div>
    );
}
