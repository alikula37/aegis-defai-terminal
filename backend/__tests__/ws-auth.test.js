import { describe, it, expect } from 'vitest';
import { validateWsSubprotocol, DEFAULT_WS_KEY } from '../utils/wsAuth.js';

describe('validateWsSubprotocol', () => {
    it('accepts the expected key in production', () => {
        expect(validateWsSubprotocol(['aegis-default-ws-key'], DEFAULT_WS_KEY, true)).toBe(DEFAULT_WS_KEY);
    });

    it('rejects any other subprotocol in production', () => {
        expect(validateWsSubprotocol(['attacker-key'], DEFAULT_WS_KEY, true)).toBe(false);
        expect(validateWsSubprotocol([], DEFAULT_WS_KEY, true)).toBe(false);
    });

    it('accepts any subprotocol in dev (falls back to expected)', () => {
        expect(validateWsSubprotocol(['something'], DEFAULT_WS_KEY, false)).toBe('something');
        expect(validateWsSubprotocol([], DEFAULT_WS_KEY, false)).toBe(false);
    });

    it('prefers the expected key when present in dev', () => {
        expect(validateWsSubprotocol(['a', DEFAULT_WS_KEY], DEFAULT_WS_KEY, false)).toBe(DEFAULT_WS_KEY);
    });

    it('handles non-array input', () => {
        const setLike = { has: () => false, values: () => [] };
        expect(validateWsSubprotocol(setLike, DEFAULT_WS_KEY, true)).toBe(false);
    });
});
