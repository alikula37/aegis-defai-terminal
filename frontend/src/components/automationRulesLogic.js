// Pure helpers for automation rule management. Kept separate from the
// component so Fast Refresh stays clean and the logic is unit-testable.

export function buildRule(condition, action) {
    return {
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        condition: condition.trim(),
        action: action.trim(),
        enabled: true,
    };
}

export function addRule(rules, condition, action) {
    return [...(rules || []), buildRule(condition, action)];
}

export function removeRule(rules, id) {
    return (rules || []).filter(r => r.id !== id);
}

export function toggleRule(rules, id) {
    return (rules || []).map(r => (r.id === id ? { ...r, enabled: !r.enabled } : r));
}
