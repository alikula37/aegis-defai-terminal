import { useState } from 'react';
import { useSettings } from '../contexts/SettingsContext';
import { addRule, removeRule, toggleRule } from './automationRulesLogic';

export default function AutomationParameters() {
    const { settings, updateSettings } = useSettings();
    const [isAdding, setIsAdding] = useState(false);
    const [condition, setCondition] = useState('');
    const [action, setAction] = useState('');
    const [isSaving, setIsSaving] = useState(false);

    const customRules = Array.isArray(settings?.automationRules) ? settings.automationRules : [];

    const systemRules = [
        {
            condition: `Health Factor < ${settings?.targetHf ?? 1.25}`,
            action: 'Rebalance',
            actionIcon: 'balance',
            actionIconColor: 'text-warning',
        },
        {
            condition: `Gas < ${settings?.maxGasClaim ?? 20} gwei`,
            action: 'Claim Rewards',
            actionIcon: 'download',
            actionIconColor: 'text-success',
        },
    ];

    const persist = async (nextRules) => {
        setIsSaving(true);
        await updateSettings({ ...settings, automationRules: nextRules });
        setIsSaving(false);
    };

    const handleAdd = async () => {
        if (!condition.trim() || !action.trim()) return;
        await persist(addRule(customRules, condition, action));
        setCondition('');
        setAction('');
        setIsAdding(false);
    };

    const handleRemove = async (id) => {
        await persist(removeRule(customRules, id));
    };

    const handleToggle = async (id) => {
        await persist(toggleRule(customRules, id));
    };

    const renderRule = (rule, removable, toggleable = true) => (
        <div
            key={rule.id ?? rule.condition}
            className={`flex items-center bg-surface-container-highest border border-outline-variant rounded-lg overflow-hidden group hover:border-primary/50 transition-colors ${rule.enabled === false ? 'opacity-50' : ''}`}
        >
            {toggleable && (
                <button
                    onClick={() => handleToggle(rule.id)}
                    className="px-3 py-2 font-[JetBrains_Mono] text-[12px] text-on-surface-variant hover:text-primary transition-colors"
                    title={rule.enabled === false ? 'Rule disabled — click to enable' : 'Rule enabled — click to disable'}
                >
                    <span className="material-symbols-outlined text-[16px]">
                        {rule.enabled === false ? 'toggle_off' : 'toggle_on'}
                    </span>
                </button>
            )}
            <div className="px-3 py-2 bg-surface-variant font-[JetBrains_Mono] text-[12px] text-primary border-x border-outline-variant">IF</div>
            <div className="px-3 py-2 font-[JetBrains_Mono] text-[12px] text-on-surface">{rule.condition}</div>
            <div className="px-3 py-2 bg-surface-variant font-[JetBrains_Mono] text-[12px] text-tertiary border-x border-outline-variant">THEN</div>
            <div className="px-3 py-2 font-[JetBrains_Mono] text-[12px] text-on-surface flex items-center gap-2">
                <span className={`material-symbols-outlined text-[16px] ${rule.actionIconColor || 'text-success'}`}>{rule.actionIcon || 'bolt'}</span>
                {rule.action}
            </div>
            {removable && (
                <button
                    onClick={() => handleRemove(rule.id)}
                    className="px-2 py-2 text-outline hover:text-error transition-colors"
                    title="Remove rule"
                >
                    <span className="material-symbols-outlined text-[16px]">close</span>
                </button>
            )}
        </div>
    );

    return (
        <div className="bg-surface-container border border-outline-variant rounded-xl p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-primary"></div>
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="font-[Inter] text-[20px] leading-[28px] font-semibold text-on-surface">Automated Execution Parameters</h3>
                    <p className="text-[14px] text-on-surface-variant mt-1">Global logic applied to active Morpho Revolver agent.</p>
                </div>
                <button
                    onClick={() => setIsAdding(!isAdding)}
                    disabled={isSaving}
                    className="p-2 border border-outline-variant rounded-lg hover:bg-surface-variant transition-colors text-on-surface disabled:opacity-50"
                    title="Add automation rule"
                >
                    <span className="material-symbols-outlined text-[20px]">{isAdding ? 'close' : 'add'}</span>
                </button>
            </div>

            {isAdding && (
                <div className="mb-4 flex flex-wrap gap-3 items-end bg-surface-variant border border-outline-variant rounded-lg p-4">
                    <div className="flex-1 min-w-[200px]">
                        <label className="block font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-1 uppercase tracking-wider">Condition</label>
                        <input
                            value={condition}
                            onChange={e => setCondition(e.target.value)}
                            placeholder="e.g. Spread < 1%"
                            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-on-surface font-[JetBrains_Mono] text-[12px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                        />
                    </div>
                    <div className="flex-1 min-w-[200px]">
                        <label className="block font-[JetBrains_Mono] text-[11px] text-on-surface-variant mb-1 uppercase tracking-wider">Action</label>
                        <input
                            value={action}
                            onChange={e => setAction(e.target.value)}
                            placeholder="e.g. Enter loop position"
                            className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-3 py-2 text-on-surface font-[JetBrains_Mono] text-[12px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                        />
                    </div>
                    <button
                        onClick={handleAdd}
                        disabled={isSaving || !condition.trim() || !action.trim()}
                        className="bg-primary-container text-on-primary-container px-4 py-2 rounded-lg font-[Inter] text-[13px] font-medium hover:brightness-110 transition-all disabled:opacity-50"
                    >
                        {isSaving ? 'Saving...' : 'Add Rule'}
                    </button>
                </div>
            )}

            <div className="flex flex-wrap gap-3">
                {systemRules.map((rule, i) => renderRule({ ...rule, id: `system-${i}`, enabled: true }, false, false))}
                {customRules.map(rule => renderRule(rule, true))}
            </div>

            {customRules.length === 0 && !isAdding && (
                <p className="font-[JetBrains_Mono] text-[11px] text-on-surface-variant mt-3">
                    System guardrails shown above. Add custom rules with the + button — they persist to the backend.
                </p>
            )}
        </div>
    );
}
