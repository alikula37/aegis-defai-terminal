import { apiFetch } from '../lib/apiClient';
import { useState, useEffect, useRef } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useSettings } from '../contexts/SettingsContext';
import { useI18n } from '../i18n/I18nProvider';
import { useModalA11y } from '../hooks/useModalA11y';

const SCENARIOS = [
    { value: 'stable', label: 'Stable — baseline spread' },
    { value: 'bull', label: 'Bull — positive spread, high funding' },
    { value: 'bear', label: 'Bear — negative spread' },
    { value: 'depeg', label: 'sUSDe depeg — liquidation stress' },
];

export default function SimulationStartModal({ isOpen, onClose, onStart }) {
    const { isStarting, executionStatus } = useWebSocket();
    const { t } = useI18n();
    // The SettingsContext already fetched /api/settings at login — reuse that
    // cache so the form renders instantly; the /api/settings call below only
    // refreshes it in the background (no spinner in the common case).
    const { settings: contextSettings, isLoading: contextSettingsLoading } = useSettings();
    const contextSettingsRef = useRef(contextSettings);
    contextSettingsRef.current = contextSettings;
    const contextLoadingRef = useRef(contextSettingsLoading);
    contextLoadingRef.current = contextSettingsLoading;
    const [settings, setSettings] = useState({
        simulationName: '',
        initialBalance: '10000',
        duration: 'Continuous',
        frequency: 'Medium',
        riskAppetite: 'Balanced',
        dataMode: 'LIVE',
        dataScenario: 'stable',
        seed: '',
        activeModel: '',
    });

    // Per-start API credentials. Secrets never come back from the server;
    // empty + configured = "keep the stored value" on save.
    const [systemConfig, setSystemConfig] = useState({ rpcUrl: '', openRouterKey: '' });
    const [configFlags, setConfigFlags] = useState({ hasRpcUrl: false, hasOpenRouterKey: false });
    const [carryOver, setCarryOver] = useState({});
    // The form renders as soon as we have settings — from the context cache
    // (instant) or from the refresh fetch. Only the first-ever open without a
    // cache shows the loading state.
    const [isLoadingSettings, setIsLoadingSettings] = useState(true);
    const [loadError, setLoadError] = useState(null);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);
    const [suggestedName, setSuggestedName] = useState(null);
    const [showKeyGuide, setShowKeyGuide] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const nameTouchedRef = useRef(false);
    const renderedRef = useRef(false);

    useEffect(() => {
        if (isOpen) {
            let cancelled = false;
            setLoadError(null);
            setError(null);
            setSuggestedName(null);
            nameTouchedRef.current = false;
            renderedRef.current = false;

            const applySettings = (data) => {
                if (cancelled || !data) return;
                // Secrets are masked server-side (never returned to the
                // browser); only "is it set?" flags come back. Empty fields
                // mean "keep the stored value" on save.
                setSystemConfig({ rpcUrl: '', openRouterKey: '' });
                setConfigFlags({ hasRpcUrl: !!data.hasRpcUrl, hasOpenRouterKey: !!data.hasOpenRouterKey });
                // Carry forward every stored preference so the settings
                // append-row save never silently resets them (slippage,
                // risk thresholds, rules, model).
                setCarryOver({
                    slippage: data.slippage,
                    targetHf: data.targetHf,
                    maxGasClaim: data.maxGasClaim,
                    automationRules: data.automationRules,
                    llmToolsEnabled: data.llmToolsEnabled,
                });
                setSettings(prev => ({
                    ...prev,
                    dataMode: data.dataMode || 'LIVE',
                    dataScenario: data.dataScenario || 'stable',
                    activeModel: data.activeModel || '',
                }));
            };

            // 1) Render immediately from the context cache when available —
            //    the /api/settings round-trip is the slow part (decrypt + the
            //    generally throttled container), so we must not block on it.
            if (!contextLoadingRef.current) {
                applySettings(contextSettingsRef.current);
                renderedRef.current = true;
                setIsLoadingSettings(false);
            }

            // 2) Background refresh — catches newer settings than the cache.
            apiFetch('/api/settings')
                .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
                .then(data => {
                    applySettings(data);
                    renderedRef.current = true;
                    setIsLoadingSettings(false);
                })
                .catch(err => {
                    console.error("Failed to fetch settings:", err);
                    // Only surface the failure if nothing rendered yet —
                    // with a cache the form is already usable.
                    setIsLoadingSettings(false);
                    if (!renderedRef.current) {
                        setLoadError(t('startModal.loadError'));
                    }
                });

            // 3) Mage-style unique name suggestion — fills in asynchronously,
            //    never overwriting what the user typed since opening.
            apiFetch('/api/simulation/suggest-name')
                .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
                .then(nameData => {
                    if (cancelled) return;
                    setSettings(prev => {
                        if (nameTouchedRef.current) return prev;
                        return { ...prev, simulationName: nameData.suggestedName || prev.simulationName };
                    });
                })
                .catch(err => console.error("Failed to suggest name:", err));

            return () => { cancelled = true; };
        }
    }, [isOpen, loadAttempt, t]);

    // E10 — a11y: role=dialog + Esc + focus trap. Called unconditionally
    // (rules-of-hooks): the hook no-ops when isOpen is false.
    const { modalRef } = useModalA11y({ isOpen, onClose });

    if (!isOpen) return null;

    const refreshName = () => {
        apiFetch('/api/simulation/suggest-name')
            .then(res => res.ok ? res.json() : null)
            .then(data => {
                if (data?.suggestedName) {
                    setSettings(prev => ({ ...prev, simulationName: data.suggestedName }));
                }
            })
            .catch(() => { /* non-critical */ });
    };

    // LIVE market data needs a working RPC + LLM key; SIM (seeded) is
    // self-contained (deterministic fallback + seeded data, no network).
    const validate = () => {
        if (settings.dataMode !== 'SIM') {
            if (!systemConfig.rpcUrl && !configFlags.hasRpcUrl) {
                return t('startModal.errLiveRpc');
            }
            if (!systemConfig.openRouterKey && !configFlags.hasOpenRouterKey) {
                return t('startModal.errLiveKey');
            }
        }
        return null;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setSuggestedName(null);

        const validationError = validate();
        if (validationError) {
            setError(validationError);
            return;
        }

        // Persist the data source + any provided credentials (empty key = keep
        // the stored one) + carry forward stored preferences. Secrets are
        // encrypted (AES-256-GCM) server-side.
        setIsSaving(true);
        try {
            const payload = {
                ...carryOver,
                dataMode: settings.dataMode,
                dataScenario: settings.dataScenario,
                activeModel: settings.activeModel || undefined,
            };
            if (systemConfig.rpcUrl) payload.rpcUrl = systemConfig.rpcUrl;
            if (systemConfig.openRouterKey) payload.openRouterKey = systemConfig.openRouterKey;
            await apiFetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
        } catch (err) {
            console.error("Failed to save settings:", err);
        } finally {
            setIsSaving(false);
        }

        const result = await onStart(settings);
        if (result && !result.success) {
            setError(result.error);
            if (result.suggestedName) {
                setSuggestedName(result.suggestedName);
            }
        }
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        // Once the user edits the name, the async suggestion must not
        // overwrite their typing.
        if (name === 'simulationName') nameTouchedRef.current = true;
        setSettings(prev => ({ ...prev, [name]: value }));
    };

    const handleConfigChange = (e) => {
        const { name, value } = e.target;
        setSystemConfig(prev => ({ ...prev, [name]: value }));
    };

    const modeIsLive = settings.dataMode !== 'SIM';
    const liveMissingRpc = modeIsLive && !systemConfig.rpcUrl && !configFlags.hasRpcUrl;
    const liveMissingKey = modeIsLive && !systemConfig.openRouterKey && !configFlags.hasOpenRouterKey;

    return (
        // Bulletproof modal scroll: the overlay itself scrolls (overflow-y-auto)
        // while the card is centered via min-h-full — never unreachable content,
        // even when the form is taller than the viewport.
        <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="start-modal-title" className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/50">
            <div className="flex min-h-full items-center justify-center p-4">
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6 w-full max-w-lg shadow-2xl relative">
                    <button
                        onClick={onClose}
                        aria-label={t('startModal.close')}
                        className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface transition-colors"
                    >
                        <span className="material-symbols-outlined">close</span>
                    </button>

                    <h2 id="start-modal-title" className="font-[Inter] text-[20px] font-semibold text-on-surface mb-6 flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary">play_circle</span>
                        {t('startModal.title')}
                    </h2>

                    {isLoadingSettings ? (
                        <div className="py-10 flex flex-col items-center gap-3 text-on-surface-variant">
                            <span className="material-symbols-outlined text-[24px] animate-spin">progress_activity</span>
                            <p className="font-[JetBrains_Mono] text-[12px]">{t('startModal.loading')}</p>
                        </div>
                    ) : loadError ? (
                        <div className="py-8 flex flex-col items-center gap-4 text-center">
                            <span className="material-symbols-outlined text-error text-[28px]">cloud_off</span>
                            <p className="font-[Inter] text-[13px] text-on-surface max-w-xs">{loadError}</p>
                            <button
                                type="button"
                                onClick={() => setLoadAttempt(a => a + 1)}
                                className="px-4 py-2 rounded-md font-[JetBrains_Mono] text-[12px] bg-primary text-accent-contrast hover:brightness-110"
                            >
                                {t('common.retry')}
                            </button>
                        </div>
                    ) : (
                        <form onSubmit={handleSubmit} noValidate className="space-y-4">
                    {executionStatus?.mode === 'onchain' && !executionStatus.ready && (
                        <div className="bg-error/10 border border-error/25 rounded-md px-3 py-2.5 flex items-start gap-2">
                            <span className="material-symbols-outlined text-error text-[18px] mt-0.5">warning</span>
                            <p className="text-[12px] leading-[16px] text-error">
                                {t('startModal.onchainNotReady')}
                            </p>
                        </div>
                    )}

                    {/* Simulation Name — auto-suggested unique (mage.ai style) */}
                    <div>
                        <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">{t('startModal.nameLabel')}</label>
                        <div className="flex gap-2 items-center">
                            <input
                                type="text"
                                name="simulationName"
                                value={settings.simulationName}
                                onChange={handleChange}
                                aria-required="true"
                                className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                            />
                            <button
                                type="button"
                                onClick={refreshName}
                                title="Generate a new unique name"
                                aria-label={t('startModal.refreshName')}
                                className="shrink-0 px-3 py-2 rounded-md border border-outline-variant text-on-surface-variant hover:text-primary hover:border-primary transition-colors"
                            >
                                <span className="material-symbols-outlined text-[18px]">refresh</span>
                            </button>
                        </div>
                        <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant mt-1">
                            {t('startModal.nameHint')}
                        </p>
                    </div>

                    {/* Market Data Source — selectable right at the start */}
                    <div>
                        <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">{t('startModal.dataSourceLabel')}</label>
                        <select
                            name="dataMode"
                            value={settings.dataMode}
                            onChange={handleChange}
                            className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                        >
                            <option value="LIVE">{t('startModal.liveOption')}</option>
                            <option value="SIM">{t('startModal.simOption')}</option>
                        </select>
                        {settings.dataMode === 'SIM' && (
                            <select
                                name="dataScenario"
                                value={settings.dataScenario}
                                onChange={handleChange}
                                className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary mt-2"
                            >
                                {SCENARIOS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                            </select>
                        )}
                        <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant mt-1">
                            {modeIsLive
                                ? t('startModal.liveHint')
                                : t('startModal.simHint')}
                        </p>
                    </div>

                    {/* API Keys — always visible */}
                    <div className="pt-4 border-t border-outline-variant space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-on-surface">
                                <span className="material-symbols-outlined text-primary text-[18px]">key</span>
                                <h3 className="font-[Inter] text-[14px] font-semibold">{t('startModal.keysTitle')}</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowKeyGuide(v => !v)}
                                className="font-[JetBrains_Mono] text-[11px] text-primary hover:underline flex items-center gap-1"
                            >
                                <span className="material-symbols-outlined text-[14px]">help</span>
                                {showKeyGuide ? t('startModal.keysGuideHide') : t('startModal.keysGuide')}
                            </button>
                        </div>

                        {showKeyGuide && (
                            <div className="bg-surface-container-lowest border border-outline-variant rounded-md p-3 space-y-2">
                                <p className="font-[JetBrains_Mono] text-[11px] leading-[16px] text-on-surface-variant">
                                    {t('startModal.keysGuideOpenRouter', { link: <a key="l" href="https://openrouter.ai" target="_blank" rel="noreferrer" className="text-primary hover:underline">openrouter.ai</a>, format: <span key="f" className="text-on-surface">sk-or-v1-...</span> })}
                                </p>
                                <p className="font-[JetBrains_Mono] text-[11px] leading-[16px] text-on-surface-variant">
                                    {t('startModal.keysGuideRpc', { alchemy: <a key="a" href="https://www.alchemy.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline">Alchemy</a>, infura: <a key="i" href="https://www.infura.io/" target="_blank" rel="noreferrer" className="text-primary hover:underline">Infura</a>, format: <span key="f" className="text-on-surface">https://sepolia.infura.io/v3/YOUR_KEY</span> })}
                                </p>
                                <p className="font-[JetBrains_Mono] text-[11px] leading-[16px] text-on-surface-variant">
                                    {t('startModal.keysGuideEncrypted')}
                                </p>
                            </div>
                        )}

                        <div>
                            <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">
                                {t('startModal.rpcLabel')} {configFlags.hasRpcUrl && <span className="text-success">· ✓ {t('common.configured')}</span>}
                            </label>
                            <input
                                type="text"
                                inputMode="url"
                                name="rpcUrl"
                                value={systemConfig.rpcUrl}
                                onChange={handleConfigChange}
                                aria-required={liveMissingRpc || undefined}
                                placeholder={configFlags.hasRpcUrl ? t('startModal.rpcPlaceholderStored') : t('startModal.rpcPlaceholderEmpty')}
                                className={`w-full bg-surface-variant border rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary ${liveMissingRpc ? 'border-error' : 'border-outline-variant'}`}
                            />
                            {liveMissingRpc && (
                                <p className="font-[JetBrains_Mono] text-[10px] text-error mt-1">{t('startModal.keyRequiredHint')}</p>
                            )}
                        </div>
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">
                                {t('startModal.keyLabel')} {configFlags.hasOpenRouterKey && <span className="text-success">· ✓ {t('common.configured')}</span>}
                            </label>
                            <input
                                type="password"
                                name="openRouterKey"
                                value={systemConfig.openRouterKey}
                                onChange={handleConfigChange}
                                aria-required={liveMissingKey || undefined}
                                placeholder={configFlags.hasOpenRouterKey ? t('startModal.keyPlaceholderStored') : t('startModal.keyPlaceholderEmpty')}
                                className={`w-full bg-surface-variant border rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary ${liveMissingKey ? 'border-error' : 'border-outline-variant'}`}
                            />
                            {liveMissingKey && (
                                <p className="font-[JetBrains_Mono] text-[10px] text-error mt-1">{t('startModal.keyRequiredHint')}</p>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">{t('startModal.initialBalance')}</label>
                        <input
                            type="number"
                            name="initialBalance"
                            value={settings.initialBalance}
                            onChange={handleChange}
                            aria-required="true"
                            min="100"
                            className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">{t('startModal.duration')}</label>
                            <select
                                name="duration"
                                value={settings.duration}
                                onChange={handleChange}
                                className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                            >
                                <option value="Continuous">{t('startModal.durationContinuous')}</option>
                                <option value="1 Hour">{t('startModal.duration1h')}</option>
                                <option value="24 Hours">{t('startModal.duration24h')}</option>
                            </select>
                        </div>
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">{t('startModal.frequency')}</label>
                            <select
                                name="frequency"
                                value={settings.frequency}
                                onChange={handleChange}
                                className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                            >
                                <option value="High">{t('startModal.freqHigh')}</option>
                                <option value="Medium">{t('startModal.freqMedium')}</option>
                                <option value="Low">{t('startModal.freqLow')}</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">{t('startModal.riskAppetite')}</label>
                        <select
                            name="riskAppetite"
                            value={settings.riskAppetite}
                            onChange={handleChange}
                            className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                        >
                            <option value="Conservative">{t('startModal.riskConservative')}</option>
                            <option value="Balanced">{t('startModal.riskBalanced')}</option>
                            <option value="Aggressive">{t('startModal.riskAggressive')}</option>
                        </select>
                    </div>

                    {/* Advanced: deterministic seed + LLM model */}
                    <div className="pt-1">
                        <button
                            type="button"
                            onClick={() => setShowAdvanced(v => !v)}
                            className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant hover:text-on-surface flex items-center gap-1"
                        >
                            <span className="material-symbols-outlined text-[14px]">{showAdvanced ? 'expand_less' : 'expand_more'}</span>
                            {t('startModal.advanced')}
                        </button>
                        {showAdvanced && (
                            <div className="mt-3 space-y-4">
                                <div>
                                    <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">{t('startModal.seedLabel')}</label>
                                    <input
                                        type="text"
                                        name="seed"
                                        value={settings.seed}
                                        onChange={handleChange}
                                        placeholder={t('startModal.seedPlaceholder')}
                                        className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                                    />
                                </div>
                                <div>
                                    <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">{t('startModal.modelLabel')}</label>
                                    <input
                                        type="text"
                                        name="activeModel"
                                        value={settings.activeModel}
                                        onChange={handleChange}
                                        placeholder={t('startModal.modelPlaceholder')}
                                        className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                                    />
                                </div>
                            </div>
                        )}
                    </div>

                    {error && (
                        <div className="mt-4 p-3 bg-error-container text-on-error-container rounded-md text-[13px] font-[Inter]">
                            <div className="flex items-center gap-2 mb-1">
                                <span className="material-symbols-outlined text-[16px]">error</span>
                                <strong>{t('startModal.error')}</strong> {error}
                            </div>
                            {suggestedName && (
                                <div className="mt-2">
                                    {t('startModal.suggestedName')} <strong>{suggestedName}</strong>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSettings(prev => ({ ...prev, simulationName: suggestedName }));
                                            setError(null);
                                            setSuggestedName(null);
                                        }}
                                        className="ml-2 text-primary hover:underline font-semibold"
                                    >
                                        Use this name
                                    </button>
                                </div>
                            )}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={isLoadingSettings || isSaving || isStarting}
                        className="w-full py-2.5 mt-4 rounded-md font-[JetBrains_Mono] text-[14px] font-[510] transition-colors flex items-center justify-center gap-2 bg-linear-to-r from-[#0f8a7e] via-[#17c3b2] to-[#7ff0e3] text-accent-contrast hover:brightness-110 disabled:opacity-50"
                    >
                        <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
                        {isStarting ? t('startModal.starting') : isSaving ? t('startModal.savingLaunching') : t('startModal.launch')}
                    </button>
                        </form>
                    )}
                </div>
            </div>
        </div>
    );
}
