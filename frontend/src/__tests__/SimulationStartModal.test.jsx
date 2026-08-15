import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SimulationStartModal from '../components/SimulationStartModal';

vi.mock('../i18n/I18nProvider', async () => {
    const en = (await import('../i18n/messages.en.js')).default;
    const api = { t: (k, vars) => { let s = en[k] ?? k; if (vars) s = String(s).replace(/\{(\w+)\}/g, (m, n) => vars[n] !== undefined ? String(vars[n]) : m); return s; }, lang: 'en', setLang: () => {} };
    return { useI18n: () => api };
});

const apiFetch = vi.fn();

vi.mock('../lib/apiClient', () => ({
    apiFetch: (...args) => apiFetch(...args),
}));

vi.mock('../contexts/WebSocketContext', () => ({
    useWebSocket: () => ({ isStarting: false, executionStatus: null }),
}));

// The modal renders instantly from the SettingsContext cache and refreshes
// from /api/settings in the background — tests drive the real values through
// apiFetch (mockRoutes), the cache only shapes the very first paint.
const useSettingsMock = vi.fn(() => ({
    settings: {
        dataMode: 'LIVE', dataScenario: 'stable', slippage: '0.5',
        targetHf: 1.25, maxGasClaim: 20, automationRules: [],
        llmToolsEnabled: true, hasRpcUrl: false, hasOpenRouterKey: false,
        activeModel: '',
    },
    isLoading: false,
}));
vi.mock('../contexts/SettingsContext', () => ({
    useSettings: (...args) => useSettingsMock(...args),
}));

vi.mock('../hooks/useModalA11y', () => ({
    useModalA11y: () => ({ modalRef: { current: null } }),
}));

const storedSettings = {
    hasRpcUrl: false,
    hasOpenRouterKey: false,
    dataMode: 'LIVE',
    dataScenario: 'stable',
    slippage: '0.5',
    targetHf: 1.25,
    maxGasClaim: 20,
    automationRules: [],
    llmToolsEnabled: true,
    activeModel: 'meta-llama/llama-3.1-70b-instruct',
};

function mockRoutes({ settings = storedSettings, name = 'sim_1a2b3c4d' } = {}) {
    apiFetch.mockImplementation((url) => {
        if (url === '/api/settings') {
            return Promise.resolve({ ok: true, json: async () => settings });
        }
        if (url === '/api/simulation/suggest-name') {
            return Promise.resolve({ ok: true, json: async () => ({ suggestedName: name }) });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
    });
}

function renderModal() {
    const onStart = vi.fn().mockResolvedValue({ success: true });
    const onClose = vi.fn();
    const utils = render(
        <SimulationStartModal isOpen onClose={onClose} onStart={onStart} />
    );
    return { onStart, onClose, ...utils };
}

// Submit the form directly — jsdom constraint validation would silently block
// clicks on empty `required` inputs (real browsers show a native bubble).
function submitForm(container) {
    fireEvent.submit(container.querySelector('form'));
}

describe('SimulationStartModal', () => {
    beforeEach(() => {
        apiFetch.mockReset();
        useSettingsMock.mockReset();
        useSettingsMock.mockImplementation(() => ({
            settings: {
                dataMode: 'LIVE', dataScenario: 'stable', slippage: '0.5',
                targetHf: 1.25, maxGasClaim: 20, automationRules: [],
                llmToolsEnabled: true, hasRpcUrl: false, hasOpenRouterKey: false,
                activeModel: '',
            },
            isLoading: false,
        }));
    });

    it('pre-fills the simulation name with a unique suggestion (mage-style)', async () => {
        mockRoutes();
        renderModal();
        await waitFor(() => {
            expect(screen.getByDisplayValue('sim_1a2b3c4d')).not.toBeNull();
        });
        // The suggestion endpoint was consulted once on open.
        expect(apiFetch).toHaveBeenCalledWith('/api/simulation/suggest-name');
    });

    it('shows the seeded scenario select when data source is SIM', async () => {
        mockRoutes({ settings: { ...storedSettings, dataMode: 'SIM' } });
        renderModal();
        await waitFor(() => {
            expect(screen.getByDisplayValue('SIM — Seeded scenario (stress testing, no network)')).not.toBeNull();
        });
        expect(screen.getByDisplayValue('Stable — baseline spread')).not.toBeNull();
    });

    it('LIVE mode blocks submit until both keys are provided (or stored)', async () => {
        mockRoutes({ settings: { ...storedSettings, hasRpcUrl: false, hasOpenRouterKey: false } });
        const { onStart, container } = renderModal();
        await waitFor(() => {
            expect(screen.getByDisplayValue('sim_1a2b3c4d')).not.toBeNull();
        });
        submitForm(container);
        await waitFor(() => {
            expect(screen.getByText(/requires a Sepolia RPC URL/i)).toBeTruthy();
        });
        expect(onStart).not.toHaveBeenCalled();
    });

    it('LIVE passes when both keys are already configured server-side', async () => {
        mockRoutes({ settings: { ...storedSettings, hasRpcUrl: true, hasOpenRouterKey: true } });
        const { onStart, container } = renderModal();
        await waitFor(() => {
            expect(screen.getByDisplayValue('sim_1a2b3c4d')).not.toBeNull();
        });
        submitForm(container);
        await waitFor(() => expect(onStart).toHaveBeenCalled());
        // Empty key fields keep the stored values (the GET call has no body —
        // only the POST /api/settings call carries one).
        const settingsPost = apiFetch.mock.calls.find(c => c[0] === '/api/settings' && c[1]?.method === 'POST');
        expect(settingsPost).toBeTruthy();
        expect(JSON.parse(settingsPost[1].body)).not.toHaveProperty('rpcUrl');
    });

    it('SIM seeded mode launches without any keys', async () => {
        mockRoutes({ settings: { ...storedSettings, dataMode: 'SIM' } });
        const { onStart, container } = renderModal();
        await waitFor(() => {
            expect(screen.getByDisplayValue('sim_1a2b3c4d')).not.toBeNull();
        });
        submitForm(container);
        await waitFor(() => expect(onStart).toHaveBeenCalled());
        const settingsPost = apiFetch.mock.calls.find(c => c[0] === '/api/settings' && c[1]?.method === 'POST');
        expect(JSON.parse(settingsPost[1].body)).toMatchObject({ dataMode: 'SIM' });
    });

    it('refresh button fetches a fresh unique name', async () => {
        mockRoutes();
        renderModal();
        await waitFor(() => {
            expect(screen.getByDisplayValue('sim_1a2b3c4d')).not.toBeNull();
        });
        apiFetch.mockClear();
        mockRoutes({ name: 'sim_9f8e7d6c' });
        fireEvent.click(screen.getByRole('button', { name: /Generate a new unique simulation name/i }));
        await waitFor(() => {
            expect(screen.getByDisplayValue('sim_9f8e7d6c')).not.toBeNull();
        });
    });

    it('renders the form instantly from the settings cache (no loading gate)', async () => {
        // Even with both fetches hanging, the cached SettingsContext data is
        // enough for the form to be interactive — the modal never blocks on
        // the network round-trip.
        apiFetch.mockImplementation(() => new Promise(() => {}));
        renderModal();
        expect(screen.getByRole('button', { name: /Launch Agent/i })).toBeTruthy();
        expect(screen.queryByText('Loading your settings…')).toBeNull();
    });

    it('shows an error state with retry when settings fail to load AND no cache exists', async () => {
        // No usable cache (context still loading) + fetch failure -> the
        // error state with retry must appear (previously silent forever).
        useSettingsMock.mockImplementation(() => ({ settings: null, isLoading: true }));
        apiFetch.mockImplementation(() => Promise.reject(new Error('network down')));
        const { container } = renderModal();
        await waitFor(() => {
            expect(screen.getByText(/Could not load your settings/i)).toBeTruthy();
        });
        expect(container.querySelector('form')).toBeNull();
        // Retry re-runs the fetches and recovers.
        apiFetch.mockReset();
        mockRoutes();
        useSettingsMock.mockImplementation(() => ({
            settings: {
                dataMode: 'LIVE', dataScenario: 'stable', slippage: '0.5',
                targetHf: 1.25, maxGasClaim: 20, automationRules: [],
                llmToolsEnabled: true, hasRpcUrl: false, hasOpenRouterKey: false,
                activeModel: '',
            },
            isLoading: false,
        }));
        fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
        await waitFor(() => {
            expect(screen.getByDisplayValue('sim_1a2b3c4d')).not.toBeNull();
        });
    });
});
