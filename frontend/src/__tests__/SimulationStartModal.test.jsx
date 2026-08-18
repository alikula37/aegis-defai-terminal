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
        activeModel: '', brainMode: 'auto',
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
    brainMode: 'auto',
};

function mockRoutes({ settings = storedSettings, name = 'sim_1a2b3c4d' } = {}) {
    apiFetch.mockImplementation((url) => {
        if (url === '/api/settings') {
            return Promise.resolve({ ok: true, json: async () => settings });
        }
        if (url === '/api/simulation/suggest-name') {
            return Promise.resolve({ ok: true, json: async () => ({ suggestedName: name }) });
        }
        if (url === '/api/llm/models') {
            return Promise.resolve({ ok: true, json: async () => ({ models: [
                { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', isFree: false },
                { id: 'google/gemini-2.5-flash-exp:free', name: 'Gemini 2.5 Flash', isFree: true },
            ] }) });
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
                activeModel: '', brainMode: 'auto',
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

    it('shares the same model picker as Settings (free pinned + catalog + custom)', async () => {
        mockRoutes();
        renderModal();
        // The model field lives in the collapsible Advanced section.
        fireEvent.click(screen.getByRole('button', { name: /Advanced/i }));
        // Same ModelPicker component as Settings: a select, not a text box.
        const modelSelect = screen.getByRole('combobox', { name: /Active LLM model/i });
        expect(modelSelect).toBeTruthy();
        // Options arrive asynchronously from the catalog endpoint.
        await waitFor(() => {
            expect(modelSelect.querySelectorAll('option').length).toBeGreaterThan(0);
        });
        // Free models are pinned first (matching Settings).
        const groups = [...modelSelect.querySelectorAll('optgroup')];
        expect(groups[0].label).toBe('🔥 Free models');
        const ids = [...modelSelect.querySelectorAll('option')].map(o => o.value);
        expect(ids).toContain('anthropic/claude-3.5-sonnet');
        expect(ids).toContain('google/gemini-2.5-flash-exp:free');
        // Changing it updates the settings that get persisted on launch.
        fireEvent.change(modelSelect, { target: { value: 'google/gemini-2.5-flash-exp:free' } });
        expect(modelSelect.value).toBe('google/gemini-2.5-flash-exp:free');
    });

    it('renders the form instantly from the settings cache (no loading gate)', async () => {        // Even with both fetches hanging, the cached SettingsContext data is
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

    // ---- Brain mode (free / no-credit UX) ----

    it('LIVE data launches without an OpenRouter key in Auto brain mode', async () => {
        mockRoutes({ settings: { ...storedSettings, hasRpcUrl: true, hasOpenRouterKey: false, brainMode: 'auto' } });
        const { onStart, container } = renderModal();
        await waitFor(() => {
            expect(screen.getByDisplayValue('sim_1a2b3c4d')).not.toBeNull();
        });
        submitForm(container);
        await waitFor(() => expect(onStart).toHaveBeenCalled());
        const settingsPost = apiFetch.mock.calls.find(c => c[0] === '/api/settings' && c[1]?.method === 'POST');
        expect(JSON.parse(settingsPost[1].body)).toMatchObject({ dataMode: 'LIVE', brainMode: 'auto' });
    });

    it('AI-only brain mode still requires an OpenRouter key for LIVE data', async () => {
        mockRoutes({ settings: { ...storedSettings, hasRpcUrl: true, hasOpenRouterKey: false, brainMode: 'llm' } });
        const { onStart, container } = renderModal();
        await waitFor(() => {
            expect(screen.getByDisplayValue('sim_1a2b3c4d')).not.toBeNull();
        });
        submitForm(container);
        await waitFor(() => {
            expect(screen.getByText(/AI-only brain mode requires an OpenRouter API key/i)).toBeTruthy();
        });
        expect(onStart).not.toHaveBeenCalled();
    });

    it('renders the brain mode selector and persists a selected mode', async () => {
        mockRoutes({ settings: { ...storedSettings, hasRpcUrl: true, hasOpenRouterKey: true, brainMode: 'auto' } });
        const { onStart, container } = renderModal();
        await waitFor(() => {
            expect(screen.getByDisplayValue('sim_1a2b3c4d')).not.toBeNull();
        });
        // Segmented control: Auto / Local only / AI only.
        expect(screen.getByRole('button', { name: /Auto/i })).toBeTruthy();
        fireEvent.click(screen.getByRole('button', { name: /Local only/i }));
        submitForm(container);
        await waitFor(() => expect(onStart).toHaveBeenCalled());
        expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ brainMode: 'local' }));
        const settingsPost = apiFetch.mock.calls.find(c => c[0] === '/api/settings' && c[1]?.method === 'POST');
        expect(JSON.parse(settingsPost[1].body)).toMatchObject({ brainMode: 'local' });
    });

    it('couples Risk Appetite to Target HF and persists both', async () => {
        mockRoutes({ settings: { ...storedSettings, hasRpcUrl: true, hasOpenRouterKey: true, brainMode: 'auto', riskAppetite: 'Balanced', frequency: 'Medium', targetHf: 1.25 } });
        const { onStart, container } = renderModal();
        await waitFor(() => {
            expect(screen.getByDisplayValue('sim_1a2b3c4d')).not.toBeNull();
        });

        // Aggressive → targetHf snaps to 1.20.
        const appetite = container.querySelector('select[name="riskAppetite"]');
        expect(appetite).toBeTruthy();
        fireEvent.change(appetite, { target: { value: 'Aggressive' } });
        submitForm(container);

        await waitFor(() => expect(onStart).toHaveBeenCalled());
        // The start body carries the derived targetHf so the backend's risk
        // zones match what the UI shows.
        expect(onStart).toHaveBeenCalledWith(expect.objectContaining({ riskAppetite: 'Aggressive', targetHf: 1.2 }));
        // And the settings POST persists appetite + frequency + targetHf.
        const settingsPost = apiFetch.mock.calls.find(c => c[0] === '/api/settings' && c[1]?.method === 'POST');
        expect(JSON.parse(settingsPost[1].body)).toMatchObject({ riskAppetite: 'Aggressive', targetHf: 1.2, frequency: 'Medium' });
    });
});
