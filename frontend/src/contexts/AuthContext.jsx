// E9 — session-based auth context. The browser holds the HttpOnly session
// cookie; JS never sees a token. On mount we ask /api/auth/me: in open mode
// (AUTH_REQUIRED=false) it returns the local user immediately and no login
// screen ever appears; in required mode a 401 means "show login".
import { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import { apiFetch, fetchJson } from '../lib/apiClient';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [authRequired, setAuthRequired] = useState(false);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    useEffect(() => {
        let cancelled = false;
        fetchJson('/api/auth/me')
            .then((data) => {
                if (cancelled) return;
                setUser(data.user);
                setAuthRequired(!!data.authRequired);
            })
            .catch((err) => {
                if (cancelled) return;
                // 401 in required mode → stay logged out (login screen).
                // Other errors (backend down) → surface, allow retry.
                if (err.status !== 401) setError(err.message);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => { cancelled = true; };
    }, []);

    const login = useCallback(async (username, password) => {
        setError('');
        try {
            const data = await fetchJson('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify({ username, password }),
            });
            setUser(data.user);
            setAuthRequired(true);
            return { ok: true };
        } catch (err) {
            setError(err.message || 'Login failed');
            return { ok: false, error: err.message };
        }
    }, []);

    const logout = useCallback(async () => {
        try {
            await apiFetch('/api/auth/logout', { method: 'POST' });
        } catch { /* session may already be gone */ }
        setUser(null);
    }, []);

    const value = useMemo(() => ({
        user,
        authRequired,
        loading,
        error,
        login,
        logout,
        isAuthenticated: !!user,
    }), [user, authRequired, loading, error, login, logout]);

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
