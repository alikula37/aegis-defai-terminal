// E9 — full-screen login (only shown when AUTH_REQUIRED=true on the backend).
// Also doubles as the registration surface for the first (admin) account.
import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';

export default function LoginPage() {
    const { login, error, authRequired } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const submit = async (e) => {
        e.preventDefault();
        if (!username || !password || submitting) return;
        setSubmitting(true);
        await login(username, password);
        setSubmitting(false);
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-background text-on-background">
            <form onSubmit={submit} className="w-full max-w-sm p-8 rounded-2xl bg-surface/50 border border-outline shadow-xl space-y-5">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight">Aegis DeFAI Terminal</h1>
                    <p className="text-sm text-muted mt-1">Sign in to access your terminal.</p>
                </div>
                {error && (
                    <div className="rounded-lg bg-error/10 border border-error/40 px-3 py-2 text-sm text-error" role="alert">
                        {error}
                    </div>
                )}
                <div className="space-y-1">
                    <label htmlFor="login-username" className="text-sm font-medium">Username</label>
                    <input
                        id="login-username"
                        type="text"
                        autoComplete="username"
                        required
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="w-full rounded-lg border border-outline bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                </div>
                <div className="space-y-1">
                    <label htmlFor="login-password" className="text-sm font-medium">Password</label>
                    <input
                        id="login-password"
                        type="password"
                        autoComplete="current-password"
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full rounded-lg border border-outline bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                </div>
                <button
                    type="submit"
                    disabled={submitting}
                    className="w-full rounded-lg bg-primary py-2.5 text-sm font-semibold text-on-primary hover:opacity-90 disabled:opacity-50"
                >
                    {submitting ? 'Signing in…' : 'Sign in'}
                </button>
                <p className="text-xs text-muted text-center">
                    The first account created on a fresh install becomes an administrator.
                    {authRequired && ' This terminal requires authentication.'}
                </p>
            </form>
        </div>
    );
}
