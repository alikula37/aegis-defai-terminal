import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('../i18n/I18nProvider', async () => {
    const en = (await import('../i18n/messages.en.js')).default;
    const api = {
        t: (k, vars) => {
            const msg = en[k] ?? k;
            if (!vars) return msg;
            return String(msg).replace(/\{(\w+)\}/g, (m, name) =>
                vars[name] !== undefined ? String(vars[name]) : m,
            );
        },
        lang: 'en',
        setLang: () => {},
    };
    return { useI18n: () => api };
});

const toast = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock('../contexts/ToastContext', () => ({ useToast: () => toast }));

vi.mock('../contexts/WebSocketContext', () => ({
    useWebSocket: () => ({ executionStatus: { mode: 'simulation', ready: true } }),
}));

vi.mock('../lib/apiClient', () => ({
    getApiKey: () => '',
    setApiKey: vi.fn(),
    apiFetch: vi.fn(async () => ({ ok: true, json: async () => ({ models: [] }) })),
}));

import Settings from '../pages/Settings';

const mockSettings = {
    rpcUrl: '',
    slippage: '0.5',
    openRouterKey: '',
    activeModel: 'google/gemini-2.5-flash-exp:free',
    brainMode: 'auto',
    riskAppetite: 'Balanced',
    frequency: 'Medium',
    targetHf: 1.25,
    maxGasClaim: 20,
    dataMode: 'SIM',
    dataScenario: 'stable',
    automationRules: [],
};

const setLocalSettings = vi.fn();
vi.mock('../contexts/SettingsContext', () => ({
    useSettings: () => ({
        settings: mockSettings,
        setLocalSettings,
        updateSettings: vi.fn(async () => true),
        clearSettings: vi.fn(async () => true),
    }),
}));

describe('Settings — brain mode (free / no-credit UX)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('renders the brain mode section with all three modes', () => {
        render(<Settings />);

        expect(screen.getByText('Brain Mode')).toBeTruthy();
        expect(screen.getByText('Auto')).toBeTruthy();
        expect(screen.getByText('Local only')).toBeTruthy();
        expect(screen.getByText('AI only')).toBeTruthy();
    });

    it('selecting a brain mode updates local settings', () => {
        render(<Settings />);

        fireEvent.click(screen.getByText('Local only'));
        expect(setLocalSettings).toHaveBeenCalledWith(expect.objectContaining({ brainMode: 'local' }));
    });

    it('the "Run free" button switches to Auto with a curated free model', () => {
        render(<Settings />);

        fireEvent.click(screen.getByRole('button', { name: /Run free/ }));
        expect(setLocalSettings).toHaveBeenCalledWith(expect.objectContaining({
            brainMode: 'auto',
            activeModel: 'google/gemini-2.5-flash-exp:free',
        }));
        expect(toast.success).toHaveBeenCalledWith('Free mode activated — Auto brain with a free model. No credits needed.');
    });

    it('pins a "Free models" group at the top of the model picker', () => {
        const { container } = render(<Settings />);
        // The model picker is the select bound to activeModel (not dataMode/scenario).
        const select = [...container.querySelectorAll('select')]
            .find(s => s.value === mockSettings.activeModel);
        expect(select).toBeTruthy();
        const optgroupLabels = [...select.querySelectorAll('optgroup')].map(o => o.label);
        expect(optgroupLabels[0]).toBe('🔥 Free models');
        expect(optgroupLabels.length).toBeGreaterThan(1); // free group + vendors/custom
    });

    it('changing Risk Appetite snaps Target HF to its preset (coupled)', () => {
        const { container } = render(<Settings />);
        // The appetite select currently shows 'Balanced'.
        const appetite = [...container.querySelectorAll('select')].find(s => s.value === 'Balanced');
        expect(appetite).toBeTruthy();

        fireEvent.change(appetite, { target: { value: 'Aggressive' } });
        expect(setLocalSettings).toHaveBeenCalledWith(expect.objectContaining({ riskAppetite: 'Aggressive', targetHf: 1.20 }));

        // Manual targetHf edits re-derive the appetite label back.
        const hfInput = [...container.querySelectorAll('input')].find(i => i.value === '1.25');
        fireEvent.change(hfInput, { target: { value: '1.40' } });
        expect(setLocalSettings).toHaveBeenCalledWith(expect.objectContaining({ targetHf: 1.4, riskAppetite: 'Conservative' }));
    });

    it('renders the Cycle Frequency selector', () => {
        const { container } = render(<Settings />);
        const freqSelect = [...container.querySelectorAll('select')]
            .find(s => s.value === 'Medium');
        expect(freqSelect).toBeTruthy();
        fireEvent.change(freqSelect, { target: { value: 'Low' } });
        expect(setLocalSettings).toHaveBeenCalledWith(expect.objectContaining({ frequency: 'Low' }));
    });
});