import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

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

const apiFetch = vi.fn();
vi.mock('../lib/apiClient', () => ({
    apiFetch: (...args) => apiFetch(...args),
    fetchJson: (...args) => apiFetch(...args),
}));

import TransactionAnalytics from '../components/TransactionAnalytics';

const txFixture = [
    {
        id: 1,
        timestamp: '2026-08-19T12:00:00Z',
        action_taken: 'Harvest Yield',
        profit_loss: 12.5,
        is_successful: 1,
        market_state_json: JSON.stringify({ netApy: 8.5, portfolio: { healthFactor: 1.4 } }),
    },
    {
        id: 2,
        timestamp: '2026-08-19T12:05:00Z',
        action_taken: 'Rebalance',
        profit_loss: -3.2,
        is_successful: 1,
        market_state_json: JSON.stringify({ netApy: 8.2, portfolio: { healthFactor: 1.4 } }),
    },
];

describe('TransactionAnalytics', () => {
    beforeEach(() => {
        apiFetch.mockReset();
        apiFetch.mockImplementation(async (url) => {
            if (String(url).includes('/api/analytics/transactions')) {
                return { ok: true, json: async () => txFixture };
            }
            if (String(url).includes('/api/portfolio/initial')) {
                return { ok: true, json: async () => ({ tvl: 100000 }) };
            }
            if (String(url).includes('/api/portfolio')) {
                return { ok: true, json: async () => ({ tvl: 112000 }) };
            }
            return { ok: true, json: async () => [] };
        });
    });

    it('renders transaction summaries and charts with data (locale-aware format helpers)', async () => {
        render(<TransactionAnalytics />);
        // Data path must render without throwing (regression: lang was not
        // destructured from useI18n, crashing with ReferenceError).
        await waitFor(() => {
            expect(screen.getByText(/\+\$12,000\.00/)).toBeTruthy(); // total yield 112000-100000
        });
        // Both chart headings render with transaction data present
        expect(screen.getByText(/Estimated Transaction Impact \(PnL\)/i)).toBeTruthy();
        expect(screen.getByText(/Yield Rate at Transaction/i)).toBeTruthy();
    });

    it('shows the empty state when there are no transactions', async () => {
        apiFetch.mockImplementation(async (url) => {
            if (String(url).includes('/api/analytics/transactions')) return { ok: true, json: async () => [] };
            return { ok: true, json: async () => ({ tvl: 100000 }) };
        });
        render(<TransactionAnalytics />);
        await waitFor(() => {
            expect(screen.getByText(/No transactions/i)).toBeTruthy();
        });
    });
});
