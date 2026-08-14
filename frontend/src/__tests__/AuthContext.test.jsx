import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import LoginPage from '../pages/LoginPage';
import { fetchJson } from '../lib/apiClient';

vi.mock('../lib/apiClient', () => ({
    apiFetch: vi.fn(async () => ({ ok: true, status: 200 })),
    fetchJson: vi.fn(),
}));

function Probe() {
    const auth = useAuth();
    return (
        <div>
            <span data-testid="user">{auth.user ? auth.user.username : 'none'}</span>
            <span data-testid="required">{String(auth.authRequired)}</span>
            <span data-testid="loading">{String(auth.loading)}</span>
            <button onClick={() => auth.logout()}>logout</button>
        </div>
    );
}

describe('AuthContext + LoginPage (E9)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('resolves the session on mount (required mode, logged in)', async () => {
        vi.mocked(fetchJson).mockResolvedValue({
            user: { id: 1, username: 'admin', role: 'admin' },
            authRequired: true,
        });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('admin'));
        expect(screen.getByTestId('required').textContent).toBe('true');
        expect(screen.getByTestId('loading').textContent).toBe('false');
    });

    it('stays logged out when me() returns 401 (required mode)', async () => {
        vi.mocked(fetchJson).mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }));
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId('loading').textContent).toBe('false'));
        expect(screen.getByTestId('user').textContent).toBe('none');
    });

    it('resolves the local user in open mode (no login screen)', async () => {
        vi.mocked(fetchJson).mockResolvedValue({
            user: { id: 1, username: 'local', role: 'admin' },
            authRequired: false,
        });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('local'));
        expect(screen.getByTestId('required').textContent).toBe('false');
    });

    it('logs in with credentials and stores the user', async () => {
        vi.mocked(fetchJson).mockResolvedValue({
            user: { id: 2, username: 'alice', role: 'user' },
            authRequired: true,
        });
        function LoginProbe() {
            const auth = useAuth();
            return (
                <div>
                    <span data-testid="who">{auth.user ? auth.user.username : 'none'}</span>
                    <button onClick={() => auth.login('alice', 'secret123')}>login</button>
                </div>
            );
        }
        render(<AuthProvider><LoginProbe /></AuthProvider>);
        fireEvent.click(screen.getByText('login'));
        await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('alice'));
        expect(fetchJson).toHaveBeenCalledWith('/api/auth/login', expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining('alice'),
        }));
    });

    it('surfaces login errors', async () => {
        vi.mocked(fetchJson).mockRejectedValue(Object.assign(new Error('Invalid username or password'), { status: 401 }));
        render(
            <AuthProvider>
                <LoginPage />
            </AuthProvider>,
        );
        fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alice' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'wrong' } });
        fireEvent.click(screen.getByRole('button', { name: /Sign in/ }));
        await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Invalid username or password'));
    });

    it('logout clears the user', async () => {
        vi.mocked(fetchJson).mockResolvedValue({
            user: { id: 1, username: 'local', role: 'admin' },
            authRequired: false,
        });
        render(<AuthProvider><Probe /></AuthProvider>);
        await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('local'));
        fireEvent.click(screen.getByText('logout'));
        await waitFor(() => expect(screen.getByTestId('user').textContent).toBe('none'));
    });

    // ---- Data-detailed: login outcome matrix ----
    it.each([
        // [server response, expected user state]
        [{ user: { id: 1, username: 'alice', role: 'user' }, authRequired: true }, 'alice'],
        [{ user: { id: 2, username: 'admin', role: 'admin' }, authRequired: true }, 'admin'],
        [null, 'none'], // server returned 200 with no user (should not happen, but must not crash)
    ])('login with server result %j → user=%s', async (serverResult, expectedUser) => {
        if (serverResult) {
            vi.mocked(fetchJson).mockResolvedValue(serverResult);
        } else {
            vi.mocked(fetchJson).mockResolvedValue({});
        }
        function LoginProbe() {
            const auth = useAuth();
            return (
                <div>
                    <span data-testid="who">{auth.user ? auth.user.username : 'none'}</span>
                    <button onClick={() => auth.login('alice', 'secret123')}>login</button>
                </div>
            );
        }
        render(<AuthProvider><LoginProbe /></AuthProvider>);
        fireEvent.click(screen.getByText('login'));
        await waitFor(() => expect(screen.getByTestId('who').textContent).toBe(expectedUser));
    });

    it.each([
        ['Invalid username or password', 401],
        ['Server exploded', 500],
        ['Network error', 0],
    ])('failed login (%s) keeps user logged out and surfaces the error', async (message, status) => {
        vi.mocked(fetchJson).mockRejectedValue(Object.assign(new Error(message), { status }));
        function LoginProbe() {
            const auth = useAuth();
            return (
                <div>
                    <span data-testid="who">{auth.user ? auth.user.username : 'none'}</span>
                    <span data-testid="err">{auth.error}</span>
                    <button onClick={() => auth.login('alice', 'wrong')}>login</button>
                </div>
            );
        }
        render(<AuthProvider><LoginProbe /></AuthProvider>);
        fireEvent.click(screen.getByText('login'));
        await waitFor(() => expect(screen.getByTestId('who').textContent).toBe('none'));
        await waitFor(() => expect(screen.getByTestId('err').textContent).toBe(message));
    });
});
