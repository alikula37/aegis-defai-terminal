import { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch, fetchJson } from '../lib/apiClient';
import { useAuth } from './AuthContext';
import { useToast } from './ToastContext';
import { useI18n } from '../i18n/I18nProvider';

const SettingsContext = createContext();

export const useSettings = () => useContext(SettingsContext);

// The app is usable without any configuration in auto/local brain modes — the
// built-in rule engine runs on live (or simulated) data with no API key. Only
// 'llm'-only mode insists on a key + RPC endpoint.
export const computeIsReady = (settings) => {
    const brainMode = settings.brainMode || 'auto';
    if (brainMode === 'llm') return Boolean(settings.rpcUrl && settings.openRouterKey);
    return true;
};

export const SettingsProvider = ({ children }) => {
    const { isAuthenticated } = useAuth();
    const toast = useToast();
    const { t } = useI18n();
    const [settings, setSettings] = useState({
        rpcUrl: '',
        slippage: '0.5',
        openRouterKey: '',
        activeModel: 'google/gemini-2.5-flash-exp:free',
        brainMode: 'auto',
        riskAppetite: 'Balanced',
        frequency: 'Medium',
        targetHf: 1.25,
        maxGasClaim: 20,
        dataMode: 'LIVE',
        dataScenario: 'stable',
        automationRules: [],
    });
    const [savedSettings, setSavedSettings] = useState(null);
    const [isReady, setIsReady] = useState(false);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        // Auth mode: the provider mounts before login, so a single mount-time
        // fetch would 401 forever. Re-run whenever the session appears.
        if (!isAuthenticated) return;
        setIsLoading(true);
        fetchJson('/api/settings')
            .then(data => {
                setSettings(data);
                setSavedSettings(data);
                setIsReady(computeIsReady(data));
            })
            .catch(err => {
                console.error("Failed to fetch settings:", err);
                // The user would otherwise edit silently-empty fields.
                toast.error(t('toast.settingsLoadFailed'));
            })
            .finally(() => setIsLoading(false));
    }, [isAuthenticated, toast, t]);

    const updateSettings = async (newSettings) => {
        try {
            const res = await apiFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(newSettings),
            });
            const data = await res.json();
            if (data.success) {
                setSettings(data.settings);
                setSavedSettings(data.settings);
                setIsReady(computeIsReady(data.settings));
                return true;
            }
            return false;
        } catch (err) {
            console.error("Failed to save settings:", err);
            return false;
        }
    };

    const clearSettings = async () => {
        try {
            await apiFetch('/api/settings', {
                method: 'DELETE',
            });
            const defaultSettings = {
                rpcUrl: '',
                slippage: '0.5',
                openRouterKey: '',
                activeModel: 'google/gemini-2.5-flash-exp:free',
                brainMode: 'auto',
                riskAppetite: 'Balanced',
                frequency: 'Medium',
                targetHf: 1.25,
                maxGasClaim: 20,
                dataMode: 'LIVE',
                dataScenario: 'stable',
                automationRules: [],
            };
            setSettings(defaultSettings);
            setSavedSettings(defaultSettings);
            setIsReady(computeIsReady(defaultSettings));
            return true;
        } catch (err) {
            console.error("Failed to clear settings:", err);
            return false;
        }
    };

    const setLocalSettings = (newSettings) => {
        setSettings(newSettings);
    };

    return (
        <SettingsContext.Provider value={{
            settings,
            savedSettings,
            setLocalSettings,
            updateSettings,
            clearSettings,
            isReady,
            isLoading
        }}>
            {children}
        </SettingsContext.Provider>
    );
};
