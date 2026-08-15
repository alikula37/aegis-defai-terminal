import { useState } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { useWebSocket } from '../contexts/WebSocketContext';
import { useToast } from '../contexts/ToastContext';
import ConfirmDialog from '../components/ConfirmDialog';
import { getApiKey, setApiKey } from '../lib/apiClient';

const LLM_MODELS = [
    { value: 'google/gemini-2.5-flash-exp:free', label: 'Gemini 2.5 Flash (Free)' },
    { value: 'meta-llama/llama-3-8b-instruct:free', label: 'Llama 3 8B Instruct (Free)' },
    { value: 'mistralai/mistral-7b-instruct:free', label: 'Mistral 7B Instruct (Free)' },
    { value: 'openchat/openchat-7b:free', label: 'OpenChat 7B (Free)' },
    { value: 'nousresearch/hermes-2-pro-llama-3-8b:free', label: 'Hermes 2 Pro Llama 3 8B (Free)' },
    { value: 'nvidia/nemotron-3-ultra-550b-a55b:free', label: 'Nemotron 3 Ultra 550B (Free)' },
    { value: 'google/gemma-4-31b-it:free', label: 'Gemma 4 31B IT (Free)' },
    { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'google/gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet' },
    { value: 'openai/gpt-4o', label: 'GPT-4o' },
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
            toast.success('Settings saved');
            setTimeout(() => setSaved(false), 3000);
        } else {
            toast.error('Failed to save settings — check the backend connection');
        }
        setIsSaving(false);
    };

    const handleClear = async () => {
        setIsClearing(true);
        const success = await clearSettings();
        if (success) {
            setSaved(false);
            toast.success('Settings history cleared');
        } else {
            toast.error('Failed to clear settings — check the backend connection');
        }
        setIsClearing(false);
    };

    return (
        <div className="flex-1 overflow-y-auto p-[2rem] bg-background">
            <div className="max-w-[960px] mx-auto space-y-6">
                <div>
                    <h2 className="font-[Inter] text-[24px] leading-[32px] font-semibold text-on-surface">System Configuration</h2>
                    <p className="text-[14px] text-on-surface-variant mt-1">Manage your agent's blockchain, API, and model settings.</p>
                </div>

                {/* Blockchain Settings */}
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
                    <h3 className="font-[Inter] text-[18px] font-semibold text-on-surface mb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined text-primary text-[20px]">link</span>
                        Blockchain Connection
                    </h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Sepolia RPC URL</label>
                            <input
                                type="url"
                                value={settings.rpcUrl}
                                onChange={e => handleChange('rpcUrl', e.target.value)}
                                placeholder="https://sepolia.infura.io/v3/YOUR_KEY"
                                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder-outline"
                            />
                        </div>
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Slippage Tolerance (%)</label>
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
                        Market Data Source
                    </h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Mode</label>
                            <select
                                value={settings.dataMode || 'LIVE'}
                                onChange={e => handleChange('dataMode', e.target.value)}
                                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                            >
                                <option value="LIVE">LIVE — Real market data (DefiLlama, Morpho, Hyperliquid)</option>
                                <option value="SIM">SIM — Seeded scenario (stress testing, no network)</option>
                            </select>
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-1">
                                LIVE uses real-time oracles. SIM uses deterministic scenarios for stress-testing the agent without network calls.
                            </p>
                        </div>
                        {(settings.dataMode || 'LIVE') === 'SIM' && (
                            <div>
                                <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Scenario</label>
                                <select
                                    value={settings.dataScenario || 'stable'}
                                    onChange={e => handleChange('dataScenario', e.target.value)}
                                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                                >
                                    <option value="stable">Stable — baseline spread</option>
                                    <option value="bull">Bull — positive spread, high funding</option>
                                    <option value="bear">Bear — negative spread</option>
                                    <option value="depeg">sUSDe depeg — liquidation stress</option>
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
                        Execution Backend
                    </h3>
                    {!executionStatus ? (
                        <p className="font-[JetBrains_Mono] text-[12px] text-on-surface-variant">Loading status…</p>
                    ) : (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5">
                                <span className="font-[JetBrains_Mono] text-[13px] text-on-surface-variant uppercase tracking-wider">Mode</span>
                                <span className={`px-2 py-0.5 rounded-md text-[12px] font-[JetBrains_Mono] border ${executionStatus.mode === 'onchain' ? (executionStatus.ready ? 'bg-success/10 text-success border-success/25' : 'bg-error/10 text-error border-error/25') : 'bg-surface-variant/50 text-on-surface-variant border-outline-variant'}`}>
                                    {executionStatus.mode === 'onchain' ? `ONCHAIN · chain ${executionStatus.chainId}` : 'SIMULATION'}
                                </span>
                            </div>
                            {executionStatus.mode === 'onchain' && (
                                <div className="bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <span className="font-[JetBrains_Mono] text-[13px] text-on-surface-variant uppercase tracking-wider">Wallet</span>
                                        <span className={`font-[JetBrains_Mono] text-[12px] ${executionStatus.signerConfigured ? 'text-success' : 'text-error'}`}>
                                            {executionStatus.signerAddress || 'NOT CONFIGURED'}
                                        </span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="font-[JetBrains_Mono] text-[13px] text-on-surface-variant uppercase tracking-wider">Status</span>
                                        <span className={`font-[JetBrains_Mono] text-[12px] ${executionStatus.ready ? 'text-success' : 'text-error'}`}>
                                            {executionStatus.ready ? 'Ready — trades broadcast on-chain' : 'Read-only — no trades broadcast'}
                                        </span>
                                    </div>
                                </div>
                            )}
                            <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-3 flex items-start gap-2">
                                <span className="material-symbols-outlined text-warning text-[16px] mt-0.5">info</span>
                                <p className="font-[JetBrains_Mono] text-[11px] leading-[16px] text-on-surface-variant">
                                    The execution backend is chosen at server startup: <span className="text-primary">EXECUTION_MODE=onchain</span> (default <span className="text-primary">simulation</span>).
                                    Onchain mode needs <span className="text-primary">EVM_PROVIDER_URL</span> + <span className="text-primary">EVM_PRIVATE_KEY</span> (testnet only) in <span className="text-primary">backend/.env</span>.
                                    Without a wallet the agent runs read-only — it observes and records, but never broadcasts trades.
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* LLM Configuration */}
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-tertiary"></div>
                    <h3 className="font-[Inter] text-[18px] font-semibold text-on-surface mb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined text-tertiary text-[20px]">psychology</span>
                        LLM Configuration (OpenRouter)
                    </h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">OpenRouter API Key</label>
                            <div className="relative">
                                <input
                                    type={showKey ? 'text' : 'password'}
                                    value={settings.openRouterKey}
                                    onChange={e => handleChange('openRouterKey', e.target.value)}
                                    placeholder="sk-or-v1-xxxxxxxxxxxxxxxx"
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
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Active LLM Model</label>
                            <select
                                value={settings.activeModel}
                                onChange={e => handleChange('activeModel', e.target.value)}
                                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                            >
                                {LLM_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                            </select>
                        </div>
                        <div className="bg-surface-container-lowest border border-outline-variant rounded-lg p-3 flex items-start gap-2">
                            <span className="material-symbols-outlined text-warning text-[16px] mt-0.5">info</span>
                            <p className="font-[JetBrains_Mono] text-[11px] leading-[16px] text-on-surface-variant">
                                <strong className="text-on-surface">Cost Optimization:</strong> The agent uses <span className="text-success">Llama 3.1 70B</span> for routine market scans and <span className="text-primary">Claude 3.5 Sonnet</span> for critical rebalance decisions.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Automation Parameters */}
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-success"></div>
                    <h3 className="font-[Inter] text-[18px] font-semibold text-on-surface mb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined text-success text-[20px]">smart_toy</span>
                        Automation Parameters
                    </h3>
                    <div className="space-y-4">
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Target Health Factor</label>
                            <input
                                type="number"
                                step="0.05"
                                min="1.05"
                                max="2.0"
                                value={settings.targetHf}
                                onChange={e => handleChange('targetHf', e.target.value === '' ? settings.targetHf : parseFloat(e.target.value))}
                                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                            />
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-1">Agent will rebalance if Health Factor drops below this value.</p>
                        </div>
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">Max Gas for Claiming (gwei)</label>
                            <input
                                type="number"
                                step="1"
                                min="1"
                                max="100"
                                value={settings.maxGasClaim}
                                onChange={e => handleChange('maxGasClaim', e.target.value === '' ? settings.maxGasClaim : parseInt(e.target.value))}
                                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                            />
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-1">Agent will only claim rewards if current gas price is below this value.</p>
                        </div>
                    </div>
                </div>

                {/* API Access */}
                <div className="bg-surface-container border border-outline-variant rounded-xl p-6 relative overflow-hidden">
                    <div className="absolute top-0 left-0 w-1 h-full bg-warning"></div>
                    <h3 className="font-[Inter] text-[18px] font-semibold text-on-surface mb-4 flex items-center gap-2">
                        <span className="material-symbols-outlined text-warning text-[20px]">key</span>
                        API Access Key (optional)
                    </h3>
                    <div className="space-y-3">
                        <div>
                            <label className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">x-api-key Header</label>
                            <div className="flex gap-2 items-center">
                                <input
                                    type="password"
                                    value={apiKeyInput}
                                    onChange={e => setApiKeyInput(e.target.value)}
                                    placeholder="Required only if the backend sets AEGIS_API_KEY"
                                    className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all placeholder-outline"
                                />
                                <button
                                    onClick={() => { setApiKey(apiKeyInput); setSaved(true); setTimeout(() => setSaved(false), 3000); }}
                                    className="bg-primary-container text-on-primary-container px-4 py-2 rounded-lg font-[Inter] text-[13px] font-medium hover:brightness-110 transition-all"
                                >
                                    Save Key
                                </button>
                            </div>
                            <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-1">
                                Stored locally in your browser and sent as <span className="text-primary">x-api-key</span> on every API request.
                            </p>
                        </div>
                    </div>
                </div>

                {/* Save Button */}
                <div className="flex justify-end gap-3">
                    {saved && (
                        <div className="flex items-center gap-2 text-success font-[JetBrains_Mono] text-[13px]">
                            <span className="material-symbols-outlined text-[18px]">check_circle</span>
                            Settings saved
                        </div>
                    )}
                    <button
                        onClick={() => setIsClearConfirmOpen(true)}
                        disabled={isClearing || isSaving}
                        className="bg-error-container text-on-error-container px-4 py-2 rounded-lg font-[Inter] text-[14px] font-medium hover:brightness-110 transition-all flex items-center gap-2 disabled:opacity-50"
                        title="Clear Settings History"
                    >
                        <span className="material-symbols-outlined text-[18px]">delete</span>
                        {isClearing ? 'Clearing...' : 'Clear'}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving || isClearing}
                        className="bg-primary-container text-on-primary-container px-6 py-2 rounded-lg font-[Inter] text-[14px] font-medium hover:brightness-110 transition-all glow-active flex items-center gap-2 disabled:opacity-50"
                    >
                        <span className="material-symbols-outlined text-[18px]">save</span>
                        {isSaving ? 'Saving...' : 'Save Configuration'}
                    </button>
                </div>
            </div>
            <ConfirmDialog
                isOpen={isClearConfirmOpen}
                title="Clear settings history?"
                message="Every stored preference, API credential and history row will be removed. This cannot be undone."
                confirmLabel="Clear"
                onCancel={() => setIsClearConfirmOpen(false)}
                onConfirm={() => {
                    setIsClearConfirmOpen(false);
                    handleClear();
                }}
            />
        </div>
    );
}
