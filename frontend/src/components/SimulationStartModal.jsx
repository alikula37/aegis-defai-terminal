import { apiFetch } from '../lib/apiClient';
import { useState, useEffect } from 'react';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useModalA11y } from '../hooks/useModalA11y';

export default function SimulationStartModal({ isOpen, onClose, onStart }) {
    const { isStarting, executionStatus } = useWebSocket();
    const [settings, setSettings] = useState({
        simulationName: 'Aegis Alpha Run',
        initialBalance: '10000',
        duration: 'Continuous',
        frequency: 'Medium',
        riskAppetite: 'Balanced'
    });

    const [systemConfig, setSystemConfig] = useState({
        rpcUrl: '',
        openRouterKey: ''
    });
    const [isConfigRequired, setIsConfigRequired] = useState(false);
    const [isLoadingSettings, setIsLoadingSettings] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState(null);
    const [suggestedName, setSuggestedName] = useState(null);

    useEffect(() => {
        if (isOpen) {
            setIsLoadingSettings(true);
            apiFetch('/api/settings')
                .then(res => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
                .then(data => {
                    // Secrets are masked server-side (never returned to the
                    // browser); only the "is it set?" flags come back. Empty
                    // fields mean "keep the stored value" on save.
                    // Secrets never reach the browser; both fields always start
                    // empty and empty means "keep stored value" on save.
                    setSystemConfig({ rpcUrl: '', openRouterKey: '' });
                    setIsConfigRequired(!data.hasRpcUrl || !data.hasOpenRouterKey);
                })
                .catch(err => console.error("Failed to fetch settings:", err))
                .finally(() => setIsLoadingSettings(false));
        }
    }, [isOpen]);

    // E10 — a11y: role=dialog + Esc + focus trap. Called unconditionally
    // (rules-of-hooks): the hook no-ops when isOpen is false.
    const { modalRef } = useModalA11y({ isOpen, onClose });

    if (!isOpen) return null;

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError(null);
        setSuggestedName(null);

        if (isConfigRequired) {
            setIsSaving(true);
            try {
                await apiFetch('/api/settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        rpcUrl: systemConfig.rpcUrl,
                        openRouterKey: systemConfig.openRouterKey,
                        slippage: '0.5', // Default value if not set
                    }),
                });
            } catch (err) {
                console.error("Failed to save initial settings:", err);
            } finally {
                setIsSaving(false);
            }
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

    return (
        <div ref={modalRef} role="dialog" aria-modal="true" aria-labelledby="start-modal-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
            <div className="bg-surface-container border border-outline-variant rounded-xl p-6 w-full max-w-md shadow-2xl relative">
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

                    <div>
                        <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Simulation Name</label>
                        <input
                            type="text"
                            name="simulationName"
                            value={settings.simulationName}
                            onChange={handleChange}
                            required
                            className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                        />
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

                    <div>
                        <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Simulation Duration</label>
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
                        <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Transaction Frequency</label>
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

                    {isLoadingSettings ? (
                        <div className="py-4 text-center text-on-surface-variant font-[JetBrains_Mono] text-[12px]">
                            Checking system configuration...
                        </div>
                    ) : isConfigRequired ? (
                        <div className="mt-6 pt-4 border-t border-outline-variant space-y-4">
                            <div className="flex items-center gap-2 text-warning mb-2">
                                <span className="material-symbols-outlined text-[18px]">warning</span>
                                <h3 className="font-[Inter] text-[14px] font-semibold">System Configuration Required</h3>
                            </div>
                            <p className="text-[12px] text-on-surface-variant mb-4">
                                Please provide your RPC URL and OpenRouter API Key to enable the agent.
                            </p>
                            <div>
                                <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">Sepolia RPC URL</label>
                                <input
                                    type="url"
                                    name="rpcUrl"
                                    value={systemConfig.rpcUrl}
                                    onChange={handleConfigChange}
                                    required
                                    placeholder="https://sepolia.infura.io/v3/..."
                                    className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                                />
                            </div>
                            <div>
                                <label className="block font-[JetBrains_Mono] text-[12px] text-on-surface-variant mb-1">OpenRouter API Key</label>
                                <input
                                    type="password"
                                    name="openRouterKey"
                                    value={systemConfig.openRouterKey}
                                    onChange={handleConfigChange}
                                    required
                                    placeholder="sk-or-v1-..."
                                    className="w-full bg-surface-variant border border-outline-variant rounded-md px-3 py-2 text-[14px] text-on-surface focus:outline-none focus:border-primary"
                                />
                            </div>
                        </div>
                    ) : null}

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
                        className="w-full py-2.5 mt-4 rounded-md font-[JetBrains_Mono] text-[14px] font-medium transition-colors flex items-center justify-center gap-2 bg-primary text-on-primary hover:bg-primary-fixed hover:text-on-primary-fixed disabled:opacity-50"
                    >
                        <span className="material-symbols-outlined text-[18px]">rocket_launch</span>
                        {isStarting ? 'Starting...' : isSaving ? 'Saving & Launching...' : 'Launch Agent'}
                    </button>
                </form>
            </div>
        </div>
    );
}
