import { useSettings } from '../contexts/SettingsContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { deriveRiskAlerts } from './riskAlertsLogic';

export default function RiskAlerts() {
    const { portfolioData } = useWebSocket();
    const { settings } = useSettings();
    const alerts = deriveRiskAlerts(portfolioData, settings);

    return (
        <div className="bg-surface-container border border-outline-variant rounded-md p-6 flex flex-col">
            <h3 className="font-[Inter] text-[20px] leading-[28px] font-semibold text-on-surface mb-6 pb-4 border-b border-outline-variant flex items-center gap-2">
                <span className="material-symbols-outlined text-warning text-[20px]">warning</span> Risk Alerts
            </h3>
            <div className="flex flex-col gap-3">
                {alerts.map((alert, i) => (
                    <div key={i} className={`${alert.bgClass} border rounded p-4 flex gap-3 items-start`}>
                        <span className={`material-symbols-outlined ${alert.iconColor} text-[18px] mt-0.5`}>{alert.icon}</span>
                        <div>
                            <p className={`text-[14px] leading-[20px] ${alert.titleColor} font-medium`}>{alert.title}</p>
                            <p className={`font-[JetBrains_Mono] text-[12px] leading-[18px] ${alert.descColor} mt-1`}>{alert.description}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}
