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

import Analytics from '../pages/Analytics';

const backtestFixture = {
    strategy: 'Pendle PT-sUSDe Delta-Neutral Loop',
    rangeDays: 90,
    leverage: 4,
    days: 90,
    totalReturn: 12.34,
    cagr: 12.34,
    sharpe: 1.8,
    maxDrawdown: 4.5,
    sortino: 2.2,
    vaR95Pct: 1.2,
    winRate: 0.8,
    equityCurve: [{ date: '2026-01-01', equity: 1 }, { date: '2026-02-01', equity: 1.03 }],
    monthly: [{ month: '2026-01', returnPct: 2.5 }],
    last: { date: '2026-02-01', loopNetApy: 9.5 },
};

const mcFixture = {
    simulations: 1000,
    days: 90,
    leverage: 4,
    liquidationProbability: 0.012,
    medianReturnPct: 8.1,
    p5ReturnPct: -3.2,
    p95ReturnPct: 21.4,
    distribution: [{ bucket: 8.1, lower: 0, upper: 16, count: 800 }],
};

const sweepFixture = [
    { leverage: 2, cagr: 6, sharpe: 1.2, maxDrawdown: 1.5 },
    { leverage: 4, cagr: 12, sharpe: 1.8, maxDrawdown: 4.5 },
];

const metricsFixture = {
    periods: 60,
    sharpeRatio: 1.5,
    sortinoRatio: 2.0,
    annualizedVolatilityPct: 14,
    maxDrawdownPct: 3.2,
    calmarRatio: 2.1,
    tailRatio: 1.9,
    equityCurve: [{ i: 0, equity: 1 }, { i: 1, equity: 1.02 }],
    returnHistogram: [{ bucket: 0.1, lower: 0, upper: 0.2, count: 30 }],
    rollingVolatility: [{ i: 29, volPct: 12 }],
};

function mockRoutes() {
    apiFetch.mockImplementation(async (url) => {
        if (String(url).startsWith('/api/backtest/sweep')) return { ok: true, json: async () => sweepFixture };
        if (String(url).startsWith('/api/backtest/monte-carlo')) return { ok: true, json: async () => mcFixture };
        if (String(url).startsWith('/api/backtest?')) return { ok: true, json: async () => backtestFixture };
        if (String(url).startsWith('/api/portfolio/metrics')) return { ok: true, json: async () => metricsFixture };
        return { ok: true, json: async () => [] };
    });
}

describe('Analytics page', () => {
    beforeEach(() => {
        apiFetch.mockReset();
        mockRoutes();
    });

    it('renders all four analytics panels and their titles', async () => {
        render(<Analytics />);
        await waitFor(() => {
            expect(screen.getByText('Historical Backtest')).toBeTruthy();
        });
        expect(screen.getByText('Monte Carlo Simulation')).toBeTruthy();
        expect(screen.getByText('Leverage Sweep')).toBeTruthy();
        expect(screen.getByText('Live Risk Metrics')).toBeTruthy();
    });

    it('shows backtest metrics and the equity curve', async () => {
        render(<Analytics />);
        await waitFor(() => {
            expect(screen.getAllByText('12.34%').length).toBeGreaterThan(0); // CAGR
        });
        // Equity curve legend label + monthly returns label
        expect(screen.getAllByText(/Equity Curve/i).length).toBeGreaterThan(0);
    });

    it('shows Monte Carlo liquidation probability and distribution', async () => {
        render(<Analytics />);
        await waitFor(() => {
            expect(screen.getByText('1.2%')).toBeTruthy(); // liquidation probability (0.012*100)
        });
        expect(screen.getAllByText(/Return Distribution/i).length).toBeGreaterThan(0);
    });

    it('surfaces a backend error instead of crashing', async () => {
        // Only the backtest route errors; the other panels keep their data.
        apiFetch.mockImplementation(async (url) => {
            if (String(url).startsWith('/api/backtest?')) return { ok: true, json: async () => ({ error: 'Not enough historical data to backtest.' }) };
            return { ok: true, json: async () => [] };
        });
        render(<Analytics />);
        await waitFor(() => {
            expect(screen.getAllByText(/Not enough historical data/i).length).toBeGreaterThan(0);
        });
    });
});