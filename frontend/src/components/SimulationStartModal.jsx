import { apiFetch } from '../lib/apiClient';
import { useState, useEffect } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useModalA11y } from '../hooks/useModalA11y';

const SCENARIOS = [
    { value: 'stable', label: 'Stable — baseline spread' },
    { value: 'bull', label: 'Bull — positive spread, high funding' },
    { value: 'bear', label: 'Bear — negative spread' },
    { value: 'depeg', label: 'sUSDe depeg — liquidation stress' },
];

export default function SimulationStartModal({ isOpen, onClose, onStart }) {
    const { isStarting, executionStatus } = useWebSocket();
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
    const [isLoadingSettings, setIsLoadingSettings] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);
    const [suggestedName, setSuggestedName] = useState(null);
    const [showKeyGuide, setShowKeyGuide] = useState(false);
    const [showAdvanced, setShowAdvanced] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setIsLoadingSettings(true);
            setError(null);
            setSuggestedName(null);
            Promise.all([
                apiFetch('/api/settings')
                    .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))),
                apiFetch('/api/simulation/suggest-name')
                    .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`))),
            ])
                .then(([data, nameData]) => {
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
                        // Mage-style unique suggestion every time the modal opens.
                        simulationName: nameData.suggestedName || prev.simulationName,
                        dataMode: data.dataMode || 'LIVE',
                        dataScenario: data.dataScenario || 'stable',
                        activeModel: data.activeModel || '',
                    }));
                })
                .catch(err => console.error("Failed to fetch settings:", err))
                .finally(() => setIsLoadingSettings(false));
        }
    }, [isOpen]);

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
                return 'LIVE market data requires a Sepolia RPC URL — add one below or switch the Market Data Source to SIM (seeded scenario).';
            }
            if (!systemConfig.openRouterKey && !configFlags.hasOpenRouterKey) {
                return 'LIVE market data requires an OpenRouter API key — add one below or switch the Market Data Source to SIM (seeded scenario).';
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
        <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="start-modal-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-surface-container border border-outline-variant rounded-xl p-6 w-full max-w-lg shadow-2xl relative max-h-[90vh] overflow-y-auto">
                <button
                    onClick={onClose}
                    aria-label="Close start simulation dialog"
                    className="absolute top-4 right-4 text-on-surface-variant hover:text-on-surface transition-colors"
                >
                    <span className="material-symbols-outlined">close</span>
                </button>

                <h2 id="start-modal-title" className="font-[Inter] text-[20px] font-semibold text-on-surface mb-6 flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary">play_circle</span>
                    Start Simulation
                </h2>

                <form onSubmit={handleSubmit} className="space-y-4">
                    {executionStatus?.mode === 'onchain' && !executionStatus.ready && (
                        <div className="bg-error/10 border border-error/25 rounded-md px-3 py-2.5 flex items-start gap-2">
                            <span className="material-symbols-outlined text-error text-[18px] mt-0.5">warning</span>
                            <p className="text-[12px] leading-[16px] text-error">
                                Onchain execution is <strong>not ready</strong> (no wallet configured). The agent will run
                                read-only: it observes and records market data, but <strong>no trades will be broadcast</strong>.
                                Configure <span className="font-[JetBrains_Mono]">EVM_PRIVATE_KEY</span> to enable live trades.
                            </p>
                        </div>
                    )}

                    {/* Simulation Name — auto-suggested unique (mage.ai style) */}
                    <div>
                        <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Simulation Name</label>
                        <div className="flex gap-2 items-center">
                            <input
                                type="text"
                                name="simulationName"
                                value={settings.simulationName}
                                onChange={handleChange}
                                required
                                className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                            />
                            <button
                                type="button"
                                onClick={refreshName}
                                title="Generate a new unique name"
                                aria-label="Generate a new unique simulation name"
                                className="shrink-0 px-3 py-2 rounded-md border border-outline-variant text-on-surface-variant hover:text-primary hover:border-primary transition-colors"
                            >
                                <span className="material-symbols-outlined text-[18px]">refresh</span>
                            </button>
                        </div>
                        <p className="font-[JetBrains_Mono] text-[10px] text-on-surface-variant mt-1">
                            Unique name suggested automatically — edit freely, the system keeps it per-user.
                        </p>
                    </div>

                    {/* Market Data Source — selectable right at the start */}
                    <div>
                        <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Market Data Source</label>
                        <select
                            name="dataMode"
                            value={settings.dataMode}
                            onChange={handleChange}
                            className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                        >
                            <option value="LIVE">LIVE — Real market data (DefiLlama, Morpho, Hyperliquid)</option>
                            <option value="SIM">SIM — Seeded scenario (stress testing, no network)</option>
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
                                ? 'LIVE uses real-time oracles and requires the API keys below.'
                                : 'SIM uses deterministic scenarios for stress-testing the agent — no network or API keys needed.'}
                        </p>
                    </div>

                    {/* API Keys — always visible */}
                    <div className="pt-4 border-t border-outline-variant space-y-4">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2 text-on-surface">
                                <span className="material-symbols-outlined text-primary text-[18px]">key</span>
                                <h3 className="font-[Inter] text-[14px] font-semibold">Blockchain &amp; AI Keys</h3>
                            </div>
                            <button
                                type="button"
                                onClick={() => setShowKeyGuide(v => !v)}
                                className="font-[JetBrains_Mono] text-[11px] text-primary hover:underline flex items-center gap-1"
                            >
                                <span className="material-symbols-outlined text-[14px]">help</span>
                                {showKeyGuide ? 'Hide guide' : 'Where do I get these?'}
                            </button>
                        </div>

                        {showKeyGuide && (
                            <div className="bg-surface-container-lowest border border-outline-variant rounded-md p-3 space-y-2">
                                <p className="font-[JetBrains_Mono] text-[11px] leading-[16px] text-on-surface-variant">
                                    <strong className="text-on-surface">OpenRouter API Key</strong> — powers the agent's AI decisions.
                                    Sign up at <a href="https://openrouter.ai" target="_blank" rel="noreferrer" className="text-primary hover:underline">openrouter.ai</a>,
                                    open <span className="text-primary">Keys</span> and click <span className="text-primary">Create Key</span>
                                    (format <span className="text-on-surface">sk-or-v1-...</span>). A few dollars of credit keeps the agent running.
                                </p>
                                <p className="font-[JetBrains_Mono] text-[11px] leading-[16px] text-on-surface-variant">
                                    <strong className="text-on-surface">Sepolia RPC URL</strong> — reads blockchain data for LIVE mode.
                                    Create a free app at <a href="https://www.alchemy.com/" target="_blank" rel="noreferrer" className="text-primary hover:underline">Alchemy</a> or
                                    <a href="https://www.infura.io/" target="_blank" rel="noreferrer" className="text-primary hover:underline"> Infura</a>,
                                    pick the <span className="text-primary">Sepolia</span> network and copy the HTTPS URL
                                    (format <span className="text-on-surface">https://sepolia.infura.io/v3/YOUR_KEY</span>).
                                </p>
                                <p className="font-[JetBrains_Mono] text-[11px] leading-[16px] text-on-surface-variant">
                                    Keys are encrypted (AES-256-GCM) before storage. <strong className="text-on-surface">SIM</strong> mode needs neither.
                                </p>
                            </div>
                        )}

                        <div>
                            <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">
                                Sepolia RPC URL {configFlags.hasRpcUrl && <span className="text-success">· ✓ configured</span>}
                            </label>
                            <input
                                type="url"
                                name="rpcUrl"
                                value={systemConfig.rpcUrl}
                                onChange={handleConfigChange}
                                aria-required={liveMissingRpc || undefined}
                                placeholder={configFlags.hasRpcUrl ? 'Leave empty to keep the stored URL' : 'https://sepolia.infura.io/v3/...'}
                                className={`w-full bg-surface-variant border rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary ${liveMissingRpc ? 'border-error' : 'border-outline-variant'}`}
                            />
                            {liveMissingRpc && (
                                <p className="font-[JetBrains_Mono] text-[10px] text-error mt-1">Required for LIVE market data.</p>
                            )}
                        </div>
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">
                                OpenRouter API Key {configFlags.hasOpenRouterKey && <span className="text-success">· ✓ configured</span>}
                            </label>
                            <input
                                type="password"
                                name="openRouterKey"
                                value={systemConfig.openRouterKey}
                                onChange={handleConfigChange}
                                aria-required={liveMissingKey || undefined}
                                placeholder={configFlags.hasOpenRouterKey ? 'Leave empty to keep the stored key' : 'sk-or-v1-...'}
                                className={`w-full bg-surface-variant border rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary ${liveMissingKey ? 'border-error' : 'border-outline-variant'}`}
                            />
                            {liveMissingKey && (
                                <p className="font-[JetBrains_Mono] text-[10px] text-error mt-1">Required for LIVE market data.</p>
                            )}
                        </div>
                    </div>

                    <div>
                        <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Initial Virtual Balance (USD)</label>
                        <input
                            type="number"
                            name="initialBalance"
                            value={settings.initialBalance}
                            onChange={handleChange}
                            required
                            min="100"
                            className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Duration</label>
                            <select
                                name="duration"
                                value={settings.duration}
                                onChange={handleChange}
                                className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                            >
                                <option value="Continuous">Continuous (Manual Stop)</option>
                                <option value="1 Hour">1 Hour</option>
                                <option value="24 Hours">24 Hours</option>
                            </select>
                        </div>
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Frequency</label>
                            <select
                                name="frequency"
                                value={settings.frequency}
                                onChange={handleChange}
                                className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                            >
                                <option value="High">High (Aggressive Scanning)</option>
                                <option value="Medium">Medium (Balanced)</option>
                                <option value="Low">Low (Conservative Scanning)</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Risk Appetite</label>
                        <select
                            name="riskAppetite"
                            value={settings.riskAppetite}
                            onChange={handleChange}
                            className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                        >
                            <option value="Conservative">Conservative (Deleverage &lt; 1.30 HF)</option>
                            <option value="Balanced">Balanced (Deleverage &lt; 1.21 HF)</option>
                            <option value="Aggressive">Aggressive (Deleverage &lt; 1.10 HF)</option>
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
                            Advanced
                        </button>
                        {showAdvanced && (
                            <div className="mt-3 space-y-4">
                                <div>
                                    <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Random Seed (optional)</label>
                                    <input
                                        type="text"
                                        name="seed"
                                        value={settings.seed}
                                        onChange={handleChange}
                                        placeholder="Same seed → same market events (deterministic)"
                                        className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                                    />
                                </div>
                                <div>
                                    <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Active LLM Model</label>
                                    <input
                                        type="text"
                                        name="activeModel"
                                        value={settings.activeModel}
                                        onChange={handleChange}
                                        placeholder="e.g. google/gemini-2.5-flash-exp:free"
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
                                <strong>Error:</strong> {error}
                            </div>
                            {suggestedName && (
                                <div className="mt-2">
                                    Suggested name: <strong>{suggestedName}</strong>
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
                        {isStarting ? 'Starting...' : isSaving ? 'Saving & Launching...' : 'Launch Agent'}
                    </button>
                </form>
            </div>
        </div>
    );
}
