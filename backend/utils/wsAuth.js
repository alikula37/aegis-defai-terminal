// backend/utils/wsAuth.js
// WebSocket authentication: the client presents the API key as a
// Sec-WebSocket-Protocol subprotocol instead of a query-string param
// (subprotocols are not logged in URLs — query strings are).

export const DEFAULT_WS_KEY = 'aegis-default-ws-key';

export function expectedWsKey() {
    const key = process.env.WS_API_KEY;
    // B4 — in production a hardcoded default key is never acceptable: an
    // operator that didn't configure WS_API_KEY gets the handshake rejected
    // (fail closed) instead of silently trusting the repo-known default.
    if (process.env.NODE_ENV === 'production') return key || null;
    return key || DEFAULT_WS_KEY;
}

/**
 * Returns the subprotocol to select, or `false` to reject the handshake.
 * In production only the exact expected key is accepted; in dev any
 * subprotocol is allowed (falling back to the expected one).
 */
export function validateWsSubprotocol(protocols, expected, isProduction) {
    const list = Array.isArray(protocols) ? protocols : Array.from(protocols || []);
    if (isProduction) {
        return list.includes(expected) ? expected : false;
    }
    return list.includes(expected) ? expected : (list[0] || false);
}
