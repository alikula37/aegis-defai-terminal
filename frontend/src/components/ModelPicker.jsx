// Shared model picker used by the Settings page AND the new-simulation start
// modal, so both screens always offer the exact same options, labels and
// defaults (free models pinned on top, then the live OpenRouter catalog
// grouped by vendor, then the user's custom selection).
import { useId } from 'react';
import { useI18n } from '../i18n/I18nProvider';

// Built-in fallback list — used only while the live OpenRouter catalog is
// loading or unreachable (the picker normally shows every model OpenRouter
// offers).
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

function groupByVendor(models) {
    const groups = new Map();
    for (const m of models) {
        const vendor = (m.id.split('/')[0] || 'other').toLowerCase();
        if (!groups.has(vendor)) groups.set(vendor, []);
        groups.get(vendor).push(m);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

// Accepts both the backend shape ({id, name, isFree}) and the local fallback
// shape ({value, label}) for free models.
function normalizeModel(m) {
    return { value: m.id ?? m.value, label: m.name ?? m.label ?? m.id ?? m.value };
}

export default function ModelPicker({
    value,
    onChange,
    modelCatalog,
    freeModels,
    labelKey,
    hintKey,
    hintVars,
    name,
    showLabel = true,
    catalogError = false,
    catalogLoading = false,
}) {
    const { t } = useI18n();
    const selectId = useId();
    const freeList = (freeModels || []).map(normalizeModel);
    const hasCatalog = modelCatalog && modelCatalog.length > 0;

    return (
        <div>
            {showLabel && (
                <label htmlFor={selectId} className="block font-[JetBrains_Mono] text-[13px] text-on-surface-variant mb-1.5 uppercase tracking-wider">{t(labelKey)}</label>
            )}
            <select
                id={selectId}
                name={name}
                value={value}
                onChange={onChange}
                className="w-full bg-surface-container-lowest border border-outline-variant rounded-lg px-4 py-2.5 text-on-surface font-[JetBrains_Mono] text-[13px] outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
            >
                {freeList.length > 0 && (
                    <optgroup label={t('settings.freeModelsGroup')}>
                        {freeList.map(m => (
                            <option key={m.value} value={m.value}>{m.label} — {m.value}</option>
                        ))}
                    </optgroup>
                )}
                {hasCatalog
                    ? groupByVendor(modelCatalog).map(([vendor, models]) => (
                        <optgroup key={vendor} label={`${vendor} (${models.length})`}>
                            {models.map(m => (
                                <option key={m.id} value={m.id}>
                                    {m.name}{m.isFree ? ' (Free)' : ''} — {m.id}
                                </option>
                            ))}
                        </optgroup>
                    ))
                    : LLM_MODELS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
                {value && (
                    <optgroup label="Custom">
                        <option value={value}>Custom — {value}</option>
                    </optgroup>
                )}
            </select>
            <p className="mt-1.5 font-[JetBrains_Mono] text-[11px] text-on-surface-variant">
                {catalogError
                    ? t('settings.modelError')
                    : catalogLoading ? t('settings.modelLoading') : t(hintKey, hintVars)}
            </p>
        </div>
    );
}