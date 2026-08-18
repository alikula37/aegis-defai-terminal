// Single source of truth for the Risk Appetite ↔ targetHf mapping used by the
// new-simulation start screen and the Settings page, so a change in one place
// propagates everywhere (and to the backend, which stores both).
export const RISK_APPETITE_PRESETS = {
    Conservative: 1.40,
    Balanced: 1.25,
    Aggressive: 1.20,
};

export const RISK_APPETITE_OPTIONS = Object.keys(RISK_APPETITE_PRESETS);

export function targetHfForAppetite(appetite) {
    const t = RISK_APPETITE_PRESETS[appetite];
    return typeof t === 'number' ? t : 1.25;
}

// Inverse mapping with tolerance — the closest preset wins, so manually typed
// targetHf values still snap to a meaningful appetite label.
export function appetiteForTargetHf(targetHf) {
    const t = Number(targetHf);
    if (!Number.isFinite(t)) return 'Balanced';
    const entries = Object.entries(RISK_APPETITE_PRESETS);
    const closest = entries.reduce((best, [name, value]) =>
        Math.abs(value - t) < Math.abs(best.value - t) ? { name, value } : best,
        { name: entries[0][0], value: entries[0][1] });
    return closest.name;
}

export const CYCLE_FREQUENCIES = [
    { value: 'High', label: 'High (15s)' },
    { value: 'Medium', label: 'Medium (30s)' },
    { value: 'Low', label: 'Low (60s)' },
];