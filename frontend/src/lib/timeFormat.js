// Format a timestamp for display; invalid/missing input renders '--:--:--'
// instead of the native "Invalid Date" leaking into the UI.
export function safeFormatTime(timestamp) {
    if (!timestamp) return '--:--:--';
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '--:--:--';
    return d.toLocaleTimeString();
}

export function safeFormatDateTime(timestamp) {
    if (!timestamp) return '—';
    const d = new Date(timestamp);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString();
}
