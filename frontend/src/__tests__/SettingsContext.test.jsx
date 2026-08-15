import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { SettingsProvider, useSettings } from '../contexts/SettingsContext';
vi.mock('../i18n/I18nProvider', async () => {
    const en = (await import('../i18n/messages.en.js')).default;
    const api = { t: (k, vars) => { let s = en[k] ?? k; if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, n) => vars[n] !== undefined ? String(vars[n]) : m); return s; }, lang: 'en', setLang: () => {} };
    return { useI18n: () => api };
});

// SettingsProvider gates its initial fetch on auth state — present a session.
vi.mock('../contexts/AuthContext', () => ({
    useAuth: () => ({ isAuthenticated: true }),
}));

vi.mock('../contexts/ToastContext', () => {
    const api = { error: vi.fn(), success: vi.fn(), info: vi.fn() };
    return { useToast: () => api };
});

const apiFetch = vi.fn();

vi.mock('../lib/apiClient', () => ({
    apiFetch: (...args) => apiFetch(...args),
    // fetchJson mirrors apiFetch but rejects on non-ok; tests mock apiFetch to
    // already return { ok, json }, so delegate directly.
    fetchJson: async (...args) => {
        const res = await apiFetch(...args);
        if (!res.ok) throw new Error(res.error || `HTTP ${res.status}`);
        return res.json();
    },
}));

const serverSettings = {
    rpcUrl: 'https://sepolia.example',
    slippage: '0.5',
    openRouterKey: 'sk-test',
    activeModel: 'model-a',
    targetHf: 1.3,
    maxGasClaim: 15,
    dataMode: 'SIM',
    dataScenario: 'bear',
    automationRules: [{ id: 'r1', condition: 'HF < 1.2', action: 'Rebalance', enabled: true }],
};

function Consumer() {
    const { settings, isLoading, isReady, updateSettings, clearSettings } = useSettings();
    return (
        <div>
            <span data-testid="mode">{settings.dataMode}</span>
            <span data-testid="hf">{settings.targetHf}</span>
            <span data-testid="rules">{settings.automationRules?.length ?? 0}</span>
            <span data-testid="loading">{String(isLoading)}</span>
            <span data-testid="ready">{String(isReady)}</span>
            <button onClick={() => updateSettings({ ...settings, dataMode: 'LIVE' })}>save</button>
            <button onClick={() => clearSettings()}>clear</button>
        </div>
    );
}

function renderWithProvider() {
    return render(
        <SettingsProvider>
            <Consumer />
        </SettingsProvider>
    );
}

describe('SettingsContext', () => {
    beforeEach(() => {
        apiFetch.mockReset();
    });

    it('loads settings from the backend on mount', async () => {
        apiFetch.mockResolvedValueOnce({ ok: true, json: async () => serverSettings });
        renderWithProvider();

        expect(screen.getByTestId('loading').textContent).toBe('true');
        await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('SIM'));
        expect(screen.getByTestId('hf').textContent).toBe('1.3');
        expect(screen.getByTestId('rules').textContent).toBe('1');
        expect(screen.getByTestId('ready').textContent).toBe('true');
    });

    it('persists updates via apiFetch and refreshes local state', async () => {
        apiFetch
            .mockResolvedValueOnce({ ok: true, json: async () => serverSettings })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true, settings: { ...serverSettings, dataMode: 'LIVE' } }) });

        renderWithProvider();
        await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('SIM'));

        await act(async () => {
            screen.getByText('save').click();
        });

        await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('LIVE'));
        const [path, options] = apiFetch.mock.calls[1];
        expect(path).toBe('/api/settings');
        expect(options.method).toBe('POST');
    });

    it('clears settings on demand', async () => {
        apiFetch
            .mockResolvedValueOnce({ ok: true, json: async () => serverSettings })
            .mockResolvedValueOnce({ ok: true, json: async () => ({ success: true }) });

        renderWithProvider();
        await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('SIM'));

        await act(async () => {
            screen.getByText('clear').click();
        });

        await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('LIVE'));
        expect(screen.getByTestId('ready').textContent).toBe('false');
    });
});
