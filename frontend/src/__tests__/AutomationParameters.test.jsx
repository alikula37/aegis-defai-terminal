import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AutomationParameters from '../components/AutomationParameters';
import { addRule, removeRule, toggleRule, buildRule } from '../components/automationRulesLogic';

const updateSettings = vi.fn(async () => true);
const mockSettings = {
    targetHf: 1.25,
    maxGasClaim: 20,
    automationRules: [
        { id: 'r1', condition: 'Spread < 1%', action: 'Enter loop position', enabled: true },
        { id: 'r2', condition: 'sUSDe > $1.01', action: 'Reduce leverage', enabled: false },
    ],
};

vi.mock('../contexts/SettingsContext', () => ({
    useSettings: () => ({ settings: mockSettings, updateSettings }),
}));

beforeEach(() => {
    updateSettings.mockClear();
});

describe('pure rule helpers', () => {
    it('builds a rule with id, trimmed values and enabled default', () => {
        const rule = buildRule('  HF < 1.2 ', '  Rebalance  ');
        expect(rule.condition).toBe('HF < 1.2');
        expect(rule.action).toBe('Rebalance');
        expect(rule.enabled).toBe(true);
        expect(rule.id).toBeTruthy();
    });

    it('adds a rule to the list', () => {
        const next = addRule([], 'A', 'B');
        expect(next).toHaveLength(1);
        expect(next[0].condition).toBe('A');
    });

    it('removes a rule by id', () => {
        const next = removeRule(mockSettings.automationRules, 'r1');
        expect(next).toHaveLength(1);
        expect(next[0].id).toBe('r2');
    });

    it('toggles a rule enabled state immutably', () => {
        const next = toggleRule(mockSettings.automationRules, 'r2');
        expect(next[1].enabled).toBe(true);
        expect(mockSettings.automationRules[1].enabled).toBe(false);
    });
});

describe('AutomationParameters component', () => {
    it('renders system guardrails derived from settings', () => {
        render(<AutomationParameters />);
        expect(screen.getByText('Health Factor < 1.25')).toBeInTheDocument();
        expect(screen.getByText('Gas < 20 gwei')).toBeInTheDocument();
        expect(screen.getByText('Rebalance')).toBeInTheDocument();
        expect(screen.getByText('Claim Rewards')).toBeInTheDocument();
    });

    it('renders persisted custom rules', () => {
        render(<AutomationParameters />);
        expect(screen.getByText('Spread < 1%')).toBeInTheDocument();
        expect(screen.getByText('Enter loop position')).toBeInTheDocument();
        expect(screen.getByText('sUSDe > $1.01')).toBeInTheDocument();
    });

    it('adds a custom rule and persists via updateSettings', async () => {
        render(<AutomationParameters />);
        fireEvent.click(screen.getByTitle('Add automation rule'));
        fireEvent.change(screen.getByPlaceholderText('e.g. Spread < 1%'), { target: { value: 'Funding > 5%' } });
        fireEvent.change(screen.getByPlaceholderText('e.g. Enter loop position'), { target: { value: 'Harvest' } });
        fireEvent.click(screen.getByText('Add Rule'));

        await waitFor(() => {
            expect(updateSettings).toHaveBeenCalledTimes(1);
            const [next] = updateSettings.mock.calls[0];
            expect(next.automationRules).toHaveLength(3);
            expect(next.automationRules[2].condition).toBe('Funding > 5%');
            expect(next.automationRules[2].action).toBe('Harvest');
        });
    });

    it('does not add when inputs are empty', async () => {
        render(<AutomationParameters />);
        fireEvent.click(screen.getByTitle('Add automation rule'));
        fireEvent.click(screen.getByText('Add Rule'));
        expect(updateSettings).not.toHaveBeenCalled();
    });

    it('removes a custom rule and persists', async () => {
        render(<AutomationParameters />);
        const removeButtons = screen.getAllByTitle('Remove rule');
        fireEvent.click(removeButtons[0]);

        await waitFor(() => {
            const [next] = updateSettings.mock.calls.at(-1);
            expect(next.automationRules).toHaveLength(1);
            expect(next.automationRules[0].id).toBe('r2');
        });
    });

    it('toggles a custom rule and persists', async () => {
        render(<AutomationParameters />);
        const toggleButtons = screen.getAllByTitle(/Rule .* — click to/);
        fireEvent.click(toggleButtons[1]);

        await waitFor(() => {
            const [next] = updateSettings.mock.calls.at(-1);
            expect(next.automationRules[1].enabled).toBe(true);
        });
    });
});
