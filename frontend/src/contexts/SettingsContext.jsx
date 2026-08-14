import { createContext, useContext, useState, useEffect } from 'react';
import { apiFetch, fetchJson } from '../lib/apiClient';

const SettingsContext = createContext();

export const useSettings = () => useContext(SettingsContext);

export const SettingsProvider = ({ children }) => {
    const [settings, setSettings] = useState({
        rpcUrl: '',
        slippage: '0.5',
        openRouterKey: '',
        activeModel: 'google/gemini-2.5-flash-exp:free',
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
        fetchJson('/api/settings')
            .then(data => {
                setSettings(data);
                setSavedSettings(data);
                setIsReady(!!data.rpcUrl && !!data.openRouterKey);
            })
            .catch(err => console.error("Failed to fetch settings:", err))
            .finally(() => setIsLoading(false));
    }, []);

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
                setIsReady(!!data.settings.rpcUrl && !!data.settings.openRouterKey);
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
                targetHf: 1.25,
                maxGasClaim: 20,
                dataMode: 'LIVE',
                dataScenario: 'stable',
                automationRules: [],
            };
            setSettings(defaultSettings);
            setSavedSettings(defaultSettings);
            setIsReady(false);
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
