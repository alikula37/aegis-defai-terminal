import { useSettings } from '../contexts/SettingsContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useI18n } from '../i18n/I18nProvider';
import { deriveRiskAlerts } from './riskAlertsLogic';

export default function RiskAlerts() {
    const { t } = useI18n();
    const { portfolioData } = useWebSocket();
    const { settings } = useSettings();
    const alerts = deriveRiskAlerts(portfolioData, settings);

    return (
        <div className="bg-surface-container border border-outline rounded-lg p-5 flex flex-col">
            <h3 className="font-[Inter] text-[18px] leading-[24px] font-[510] text-paper mb-4 pb-4 border-b border-outline-variant flex items-center gap-2">
                <span className="material-symbols-outlined text-warning text-[20px]">warning</span> {t('risk.title')}
            </h3>
            <div className="flex flex-col gap-3">
                {alerts.length === 0 && (
                    <div className="border border-outline-variant rounded p-4 flex gap-3 items-start bg-success/5">
                        <span className="material-symbols-outlined text-success text-[18px] mt-0.5">verified</span>
                        <div>
                            <p className="text-[14px] leading-[20px] text-success font-medium">{t('risk.nominal')}</p>
                            <p className={`font-[JetBrains_Mono] text-[12px] leading-[18px] text-on-surface-variant mt-1`}>{t('risk.nominalDesc')}</p>
                        </div>
                    </div>
                )}
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
