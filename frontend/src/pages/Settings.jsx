import { useState, useEffect } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useToast } from '../contexts/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import ModelPicker from '../components/ModelPicker';
import { getApiKey, setApiKey, apiFetch } from '../lib/apiClient';
import { useI18n } from '../i18n/I18nProvider';
import { RISK_APPETITE_OPTIONS, targetHfForAppetite, appetiteForTargetHf, CYCLE_FREQUENCIES } from '../lib/riskPresets';

// Curated, reliably-free models — guaranteed zero-credit options regardless of
// the live catalog (also used by the "Run free" one-click button).
const FREE_MODEL_FALLBACKS = [
    { value: 'google/gemini-2.5-flash-exp:free', label: 'Gemini 2.5 Flash (Free)' },
    { value: 'meta-llama/llama-3-8b-instruct:free', label: 'Llama 3 8B Instruct (Free)' },
    { value: 'mistralai/mistral-7b-instruct:free', label: 'Mistral 7B Instruct (Free)' },
    { value: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B IT (Free)' },
    { value: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B (Free)' },
];

export default function Settings() {
    const { settings, setLocalSettings, updateSettings, clearSettings } = useSettings();
    const { executionStatus } = useWebSocket();
    const toast = useToast();
    const [saved, setSaved] = useState(false);
    const [showKey, setShowKey] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isClearing, setIsClearing] = useState(false);
    const [isClearConfirmOpen, setIsClearConfirmOpen] = useState(false);
    const [apiKeyInput, setApiKeyInput] = useState(getApiKey());
    const [modelCatalog, setModelCatalog] = useState(null);
    const [freeModels, setFreeModels] = useState(FREE_MODEL_FALLBACKS);
    const [catalogLoading, setCatalogLoading] = useState(true);
    const [catalogError, setCatalogError] = useState(false);
    const { t } = useI18n();

    const loadModelCatalog = (showSpinner = true) => {
        if (showSpinner) setCatalogLoading(true);
        apiFetch('/api/llm/models')
            .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
            .then(data => {
                setModelCatalog(data.models || []);
                if (Array.isArray(data.freeModels) && data.freeModels.length > 0) {
                    setFreeModels(data.freeModels.map(m => ({ value: m.id, label: m.name || m.id })));
                }
                setCatalogError(false);
            })
            .catch(err => {
                console.error('Failed to load model catalog:', err);
                setCatalogError(true);
            })
            .finally(() => setCatalogLoading(false));
    };

    useEffect(() => {
        loadModelCatalog();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleChange = (field, value) => {
        setLocalSettings({ ...settings, [field]: value });
        setSaved(false);
    };

    const handleSave = async () => {
        setIsSaving(true);
        const success = await updateSettings(settings);
        setSaved(false);
        if (success) {
            setSaved(true);
            toast.success(t('toast.settingsSaved'));
            setTimeout(() => setSaved(false), 3000);
        } else {
            toast.error(t('toast.settingsSaveFailed'));
        }
        setIsSaving(false);
    };

    // One-click free path: Auto mode + best curated free model. No API key and
    // no credits needed — the built-in rule engine runs the show on live data.
    const handleRunFree = () => {
        const freeModel = (freeModels[0] && freeModels[0].value) || FREE_MODEL_FALLBACKS[0].value || settings.activeModel;
        setLocalSettings({ ...settings, brainMode: 'auto', activeModel: freeModel });
        setSaved(false);
        toast.success(t('settings.freeModeActivated'));
    };

    const handleClear = async () => {
        setIsClearing(true);
        const success = await clearSettings();
        if (success) {
            setSaved(false);
            toast.success(t('toast.settingsCleared'));
        } else {
            toast.error(t('toast.settingsClearFailed'));
        }
        setIsClearing(false);
    };

    return (
        <div className="flex-1 overflow-y-auto p-[2rem] bg-background">
            <div className="max-w-[960px] mx-auto space-y-6">
                <div>
                    <h2 className="font-[Inter] text-[24px] leading-[32px] font-semibold text-on-surface">{t('settings.title')}</h2>
                    <p className="text-[14px] text-on-surface-variant mt-1">{t('settings.subtitle')}</p>
                </div>

                {/* Blockchain Settings */}
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
                    <h3 className="font-[Inter] text-[18px] font-semibold text-on-surface mb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-[20px]">link</span>
                        {t('settings.blockchain')}
                    </h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">{t('settings.rpcUrl')}</label>
                            <input
                                type="text" inputMode="url"
                                value={settings.rpcUrl}
                                onChange={e => handleChange('rpcUrl', e.target.value)}
                                placeholder={t('settings.rpcPlaceholder')}
                                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder-outline"
                            />
                        </div>
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">{t('settings.slippage')}</label>
                            <div className="flex gap-2 items-center">
                                <input
                                    type="number"
                                    step="0.1"
                                    min="0.1"
                                    max="5"
                                    value={settings.slippage}
                                    onChange={e => handleChange('slippage', e.target.value)}
                                    className="w-32 bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                                />
                                <div className="flex gap-1">
                                    {['0.1', '0.5', '1.0'].map(v => (
                                        <button
                                            key={v}
                                            onClick={() => handleChange('slippage', v)}
                                            className={`px-2.5 py-1.5 rounded-md border text-[12px] font-[JetBrains_Mono] transition-colors ${settings.slippage === v ? 'bg-primary/10 border-primary/30 text-primary' : 'border-outline-variant text-on-surface-variant hover:bg-surface-variant'}`}
                                        >{v}%</button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Data Source */}
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-warning"></div>
                    <h3 className="font-[Inter] text-[18px] font-semibold text-on-surface mb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined text-warning text-[20px]">database</span>
                        {t('startModal.dataSourceLabel')}
                    </h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">{t('settings.mode')}</label>
                            <select
                                value={settings.dataMode || 'LIVE'}
                                onChange={e => handleChange('dataMode', e.target.value)}
                                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                            >
                                <option value="LIVE">{t('startModal.liveOption')}</option>
                                <option value="SIM">{t('startModal.simOption')}</option>
                            </select>
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-1">
                                {t('settings.modeHint')}
                            </p>
                        </div>
                        {(settings.dataMode || 'LIVE') === 'SIM' && (
                            <div>
                                <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">{t('settings.scenario')}</label>
                                <select
                                    value={settings.dataScenario || 'stable'}
                                    onChange={e => handleChange('dataScenario', e.target.value)}
                                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                                >
                                    <option value="stable">{t('settings.scenarioStable')}</option>
                                    <option value="bull">{t('startModal.scenarioBull')}</option>
                                    <option value="bear">{t('settings.scenarioBear')}</option>
                                    <option value="depeg">{t('startModal.scenarioDepeg')}</option>
                                </select>
                            </div>
                        )}
                    </div>
                </div>

                {/* Execution Backend */}
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-success"></div>
                    <h3 className="font-[Inter] text-[18px] font-semibold text-on-surface mb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined text-success text-[20px]">rocket_launch</span>
                        {t('docs.execution')}
                    </h3>
                    {!executionStatus ? (
                        <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant">{t('common.loading')}</p>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5">
                                <span className="font-[JetBrains_Mono] text-[13px] text-on-surface-variant uppercase tracking-wider">{t('settings.mode')}</span>
                                <span className={`px-2 py-0.5 rounded-md text-[12px] font-[JetBrains_Mono] border ${executionStatus.mode === 'onchain' ? (executionStatus.ready ? 'bg-success/10 text-success border-success/25' : 'bg-error/10 text-error border-error/25') : 'bg-surface-variant/50 text-on-surface-variant border-outline-variant'}`}>
                                    {executionStatus.mode === 'onchain' ? t('settings.onchainChain', { chainId: executionStatus.chainId }) : t('settings.simulation')}
                                </span>
                            </div>
                            {executionStatus.mode === 'onchain' && (
                                <div className="bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <span className="font-[JetBrains_Mono] text-[13px] text-on-surface-variant uppercase tracking-wider">{t('settings.wallet')}</span>
                                        <span className={`font-[JetBrains_Mono] text-[12px] ${executionStatus.signerConfigured ? 'text-success' : 'text-error'}`}>
                                            {executionStatus.signerAddress || t('settings.notConfigured')}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="font-[JetBrains_Mono] text-[13px] text-on-surface-variant uppercase tracking-wider">{t('market.status')}</span>
                                        <span className={`font-[JetBrains_Mono] text-[12px] ${executionStatus.ready ? 'text-success' : 'text-error'}`}>
                                            {executionStatus.ready ? t('settings.readyOnchain') : t('settings.readOnly')}
                                        </span>
                                    </div>
                                </div>
                            )}
                            <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-3 flex items-start gap-2">
                                <span className="material-symbols-outlined text-warning text-[16px] mt-0.5">info</span>
                                <p className="font-[JetBrains_Mono] text-[11px] leading-[16px] text-on-surface-variant">
                                    {t('settings.executionBackendBody')}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Brain Mode */}
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-tertiary"></div>
                    <h3 className="font-[Inter] text-[18px] font-semibold text-on-surface mb-1 flex items-center gap-2">
                        <span className="material-symbols-outlined text-tertiary text-[20px]">psychology</span>
                        {t('settings.brainModeTitle')}
                    </h3>
                    <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-4">{t('settings.brainModeHint')}</p>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        {[
                            { value: 'auto', label: t('settings.brainAuto'), desc: t('settings.brainAutoDesc'), icon: 'auto_awesome' },
                            { value: 'local', label: t('settings.brainLocal'), desc: t('settings.brainLocalDesc'), icon: 'memory' },
                            { value: 'llm', label: t('settings.brainLlm'), desc: t('settings.brainLlmDesc'), icon: 'psychology' },
                        ].map(mode => (
                            <button
                                key={mode.value}
                                type="button"
                                onClick={() => handleChange('brainMode', mode.value)}
                                className={`text-left rounded-xl border p-4 transition-all ${(settings.brainMode || 'auto') === mode.value
                                    ? 'bg-tertiary/10 border-tertiary/50 ring-1 ring-tertiary/30'
                                    : 'bg-surface-container-lowest border-outline-variant hover:border-tertiary/40'}`}
                            >
                                <div className="flex items-center gap-2 mb-1.5">
                                    <span className={`material-symbols-outlined text-[18px] ${(settings.brainMode || 'auto') === mode.value ? 'text-tertiary' : 'text-on-surface-variant'}`}>{mode.icon}</span>
                                    <span className="font-[Inter] text-[14px] font-semibold text-on-surface">{mode.label}</span>
                                </div>
                                <p className="font-[JetBrains_Mono] text-[11px] leading-[16px] text-on-surface-variant">{mode.desc}</p>
                            </button>
                        ))}
                    </div>
                    <div className="mt-4 bg-surface-container-lowest border border-success/25 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">
                        <div className="flex items-start gap-2 min-w-0">
                            <span className="material-symbols-outlined text-success text-[18px] mt-0.5">bolt</span>
                            <div className="min-w-0">
                                <p className="font-[Inter] text-[13px] font-medium text-on-surface">{t('settings.runFreeHint')}</p>
                                <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-0.5">{t('settings.noKeyInfoMsg')}</p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleRunFree}
                            className="bg-success text-on-success px-4 py-2 rounded-lg font-[Inter] text-[13px] font-semibold hover:brightness-110 transition-all whitespace-nowrap flex items-center gap-2"
                        >
                            <span className="material-symbols-outlined text-[18px]">bolt</span>
                            {t('settings.runFree')}
                        </button>
                    </div>
                </div>

                {/* LLM Configuration */}
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-tertiary"></div>
                    <h3 className="font-[Inter] text-[18px] font-semibold text-on-surface mb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined text-tertiary text-[20px]">psychology</span>
                        {t('settings.llmConfig')}
                    </h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">{t('settings.apiKey')}</label>
                            <div className="relative">
                                <input
                                    type={showKey ? 'text' : 'password'}
                                    value={settings.openRouterKey}
                                    onChange={e => handleChange('openRouterKey', e.target.value)}
                                    placeholder={t('settings.apiKeyPlaceholder')}
                                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 pr-12 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder-outline"
                                />
                                <button
                                    onClick={() => setShowKey(!showKey)}
                                    className="absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant hover:text-primary transition-colors"
                                >
                                    <span className="material-symbols-outlined text-[18px]">{showKey ? 'visibility_off' : 'visibility'}</span>
                                </button>
                            </div>
                        </div>
                        <div>
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant uppercase tracking-wider">{t('settings.model')}</span>
                                <button
                                    type="button"
                                    onClick={() => loadModelCatalog()}
                                    disabled={catalogLoading}
                                    className="flex items-center gap-1 font-[JetBrains_Mono] text-[11px] text-primary hover:text-on-surface transition-colors disabled:opacity-50"
                                    title={t('settings.modelRefresh')}
                                >
                                    <span className={`material-symbols-outlined text-[14px] ${catalogLoading ? 'animate-spin' : ''}`}>refresh</span>
                                    {t('settings.modelRefresh')}
                                </button>
                            </div>
                            <ModelPicker
                                value={settings.activeModel}
                                onChange={e => handleChange('activeModel', e.target.value)}
                                modelCatalog={modelCatalog}
                                freeModels={freeModels}
                                labelKey="settings.model"
                                hintKey="settings.modelHint"
                                showLabel={false}
                                catalogError={catalogError}
                                catalogLoading={catalogLoading}
                            />
                        </div>
                        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-3 flex items-start gap-2">
                            <span className="material-symbols-outlined text-warning text-[16px] mt-0.5">info</span>
                            <p className="font-[JetBrains_Mono] text-[11px] leading-[16px] text-on-surface-variant">
                                {t('settings.costOpt')}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Automation Parameters */}
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-success"></div>
                    <h3 className="font-[Inter] text-[18px] font-semibold text-on-surface mb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined text-success text-[20px]">smart_toy</span>
                        {t('settings.automationParams')}
                    </h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">{t('settings.riskAppetite')}</label>
                            <select
                                value={settings.riskAppetite || 'Balanced'}
                                onChange={e => {
                                    const value = e.target.value;
                                    // Appetite is the high-level control — picking
                                    // one snaps targetHf to its preset so the start
                                    // screen, Settings and Overview stay in sync.
                                    setLocalSettings({ ...settings, riskAppetite: value, targetHf: targetHfForAppetite(value) });
                                    setSaved(false);
                                }}
                                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                            >
                                {RISK_APPETITE_OPTIONS.map(a => (
                                    <option key={a} value={a}>
                                        {t(`settings.appetite${a}`)} — target HF {targetHfForAppetite(a).toFixed(2)}
                                    </option>
                                ))}
                            </select>
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-1">{t('settings.riskAppetiteHint')}</p>
                        </div>
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">{t('settings.targetHf')}</label>
                            <input
                                type="number"
                                step="0.05"
                                min="1.05"
                                max="2.0"
                                value={settings.targetHf}
                                onChange={e => {
                                    const value = e.target.value === '' ? settings.targetHf : parseFloat(e.target.value);
                                    // Manual targetHf edits re-derive the appetite
                                    // label so the two never drift apart.
                                    setLocalSettings({ ...settings, targetHf: value, riskAppetite: appetiteForTargetHf(value) });
                                    setSaved(false);
                                }}
                                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                            />
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-1">{t('settings.targetHfHint')}</p>
                        </div>
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">{t('settings.maxGasClaim')}</label>
                            <input
                                type="number"
                                step="1"
                                min="1"
                                max="100"
                                value={settings.maxGasClaim}
                                onChange={e => handleChange('maxGasClaim', e.target.value === '' ? settings.maxGasClaim : parseInt(e.target.value))}
                                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                            />
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-1">{t('settings.maxGasHint')}</p>
                        </div>
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">{t('settings.cycleFrequency')}</label>
                            <select
                                value={settings.frequency || 'Medium'}
                                onChange={e => handleChange('frequency', e.target.value)}
                                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                            >
                                {CYCLE_FREQUENCIES.map(f => (
                                    <option key={f.value} value={f.value}>{f.label}</option>
                                ))}
                            </select>
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-1">{t('settings.cycleFrequencyHint')}</p>
                        </div>
                    </div>
                </div>

                {/* API Access */}
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-warning"></div>
                    <h3 className="font-[Inter] text-[18px] font-semibold text-on-surface mb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined text-warning text-[20px]">key</span>
                        {t('settings.apiKeyOptional')}
                    </h3>
                    <div className="space-y-3">
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">{t('settings.apiKeyHeader')}</label>
                            <div className="flex gap-2 items-center">
                                <input
                                    type="password"
                                    value={apiKeyInput}
                                    onChange={e => setApiKeyInput(e.target.value)}
                                    placeholder={t('settings.apiKeyRequiredOnly')}
                                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder-outline"
                                />
                                <button
                                    onClick={() => { setApiKey(apiKeyInput); setSaved(true); setTimeout(() => setSaved(false), 3000); }}
                                    className="bg-primary-container text-on-primary-container px-4 py-2 rounded-lg font-[Inter] text-[13px] font-medium hover:brightness-110 transition-all"
                                >
                                    {t('settings.saveKey')}
                                </button>
                            </div>
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-1">
                                {t('settings.apiKeyStored')}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Save Button */}
                <div className="flex justify-end gap-3">
                    {saved && (
                        <div className="flex items-center gap-2 text-success font-[JetBrains_Mono] text-[13px]">
                            <span className="material-symbols-outlined text-[18px]">check_circle</span>
                            {t('toast.settingsSaved')}
                        </div>
                    )}
                    <button
                        onClick={() => setIsClearConfirmOpen(true)}
                        disabled={isClearing || isSaving}
                        className="bg-error-container text-on-error-container px-4 py-2 rounded-lg font-[Inter] text-[14px] font-medium hover:brightness-110 transition-all flex items-center gap-2 disabled:opacity-50"
                        title={t('settings.clearHistory')}
                    >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                        {isClearing ? t('settings.clearing') : t('settings.clear')}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || isClearing}
                        className="bg-primary-container text-on-primary-container px-6 py-2 rounded-lg font-[Inter] text-[14px] font-medium hover:brightness-110 transition-all glow-active flex items-center gap-2 disabled:opacity-50"
                    >
                        <span className="material-symbols-outlined text-[18px]">save</span>
                        {isSaving ? t('common.saving') : t('settings.save')}
                    </button>
                </div>
            </div>
            <ConfirmDialog
                isOpen={isClearConfirmOpen}
                title={t('confirm.clearSettingsTitle')}
                message={t('confirm.clearSettingsMsg')}
                confirmLabel={t('confirm.clear')}
                onCancel={() => setIsClearConfirmOpen(false)}
                onConfirm={() => {
                    setIsClearConfirmOpen(false);
                    handleClear();
                }}
            />
        </div>
    );
}
