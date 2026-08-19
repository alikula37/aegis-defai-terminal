import BacktestPanel from '../components/BacktestPanel';
import MonteCarloPanel from '../components/MonteCarloPanel';
import LeverageSweepPanel from '../components/LeverageSweepPanel';
import LiveRiskPanel from '../components/LiveRiskPanel';
import { useI18n } from '../i18n/I18nProvider';

export default function Analytics() {
    const { t } = useI18n();

    return (
        <div className="flex-1 overflow-y-auto p-[1.5rem] bg-background">
            <div className="max-w-[1400px] mx-auto flex flex-col gap-[1rem]">
                {/* Header */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                        <h2 className="font-[Inter] text-[24px] font-semibold text-on-surface">
                            {t('analytics.title')}
                        </h2>
                        <p className="text-[14px] text-on-surface-variant mt-1">{t('analytics.subtitle')}</p>
                    </div>
                    <span className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant bg-surface-container border border-outline-variant px-3 py-1.5 rounded-full">
                        {t('analytics.poweredBy')}
                    </span>
                </div>

                {/* Backtest + Monte Carlo */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-[1rem] items-start">
                    <BacktestPanel />
                    <MonteCarloPanel />
                </div>

                {/* Leverage sweep + live risk */}
                <div className="grid grid-cols-1 xl:grid-cols-2 gap-[1rem] items-start">
                    <LeverageSweepPanel />
                    <LiveRiskPanel />
                </div>
            </div>
        </div>
    );
}