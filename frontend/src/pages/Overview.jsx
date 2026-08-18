import { useWebSocket } from '../contexts/WebSocketContext';
import DashboardMetrics from '../components/DashboardMetrics';
import LiveYieldChart from '../components/LiveYieldChart';
import RiskAlerts from '../components/RiskAlerts';
import AgentTerminal from '../components/AgentTerminal';
import TvlProjectionChart from '../components/TvlProjectionChart';
import { useI18n } from '../i18n/I18nProvider';

export default function Overview() {
    const { t } = useI18n();
    const { isSimulationRunning, hasData, setIsStartModalOpen, setIsResumeModalOpen } = useWebSocket();

    const isSimulationStarted = isSimulationRunning || hasData;

    if (!isSimulationStarted) {
        return (
            <main className="flex-1 overflow-y-auto p-[2rem] bg-background flex flex-col items-center justify-center min-h-screen">
                <div className="bg-surface-container border border-outline-variant rounded-xl p-8 max-w-md w-full text-center shadow-2xl">
                    <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                        <span className="material-symbols-outlined text-primary text-3xl">rocket_launch</span>
                    </div>
                    <h2 className="font-[Inter] text-[24px] font-bold text-on-surface mb-2">{t('yield.idleTitle')}</h2>
                    <p className="font-[JetBrains_Mono] text-[14px] text-on-surface-variant mb-8">
                        {t('yield.idleMsg')}
                    </p>
                    <div className="flex gap-4 max-w-sm mx-auto">
                        <button
                            onClick={() => setIsStartModalOpen(true)}
                            className="flex-1 py-3 rounded-md font-[JetBrains_Mono] text-[14px] font-medium transition-colors flex items-center justify-center gap-2 bg-primary text-on-primary hover:bg-primary-fixed hover:text-on-primary-fixed"
                        >
                            <span className="material-symbols-outlined text-[18px]">play_circle</span>
                            {t('nav.startNew')}
                        </button>
                        <button
                            onClick={() => setIsResumeModalOpen(true)}
                            className="flex-1 py-3 rounded-md font-[JetBrains_Mono] text-[14px] font-medium transition-colors flex items-center justify-center gap-2 border border-primary text-primary hover:bg-primary/10"
                        >
                            <span className="material-symbols-outlined text-[18px]">restore</span>
                            {t('nav.resume')}
                        </button>
                    </div>
                </div>
            </main>
        );
    }

    return (
        <div className="p-[1.5rem] flex flex-col gap-[1rem] overflow-y-auto">
            {/* Top Metrics Row */}
            <DashboardMetrics />

            {/* Middle Grid: Chart + Risk Alerts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-[1rem]">
                <div className="lg:col-span-2">
                    <LiveYieldChart />
                </div>
                <div className="lg:col-span-1">
                    <RiskAlerts />
                </div>
            </div>

            {/* TVL Projection Chart */}
            <div className="grid grid-cols-1 gap-[1rem]">
                <TvlProjectionChart />
            </div>

            {/* Bottom: Agent Terminal */}
            <AgentTerminal />
        </div>
    );
}
