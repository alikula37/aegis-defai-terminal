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

const opportunitiesFixture = {
    status: 'LIVE',
    generatedAt: '2026-08-19T00:00:00.000Z',
    opportunities: [
        {
            id: 'susde-stake', name: 'sUSDe Staking', protocol: 'Ethena', chain: 'Ethereum',
            category: 'staking', riskTier: 'low', baseApy: 4.5, rewardApy: 0, totalApy: 4.5,
            tvlUsd: 1.3e9, stablecoin: true, ilRisk: 'no',
            prediction: { cls: 'Stable/Up', probability: 71 }, momentum7d: 0.1, momentum30d: -0.2,
            source: 'DefiLlama', sourceUrl: 'https://defillama.com/yields/pool/x', ourStrategy: false, warning: null,
        },
        {
            id: 'delta-neutral-loop', name: 'sUSDe Delta-Neutral Loop', protocol: 'AEGIS', chain: 'Ethereum',
            category: 'deltaNeutral', riskTier: 'high', baseApy: -0.5, rewardApy: 0, totalApy: -0.5,
            tvlUsd: null, stablecoin: true, ilRisk: 'no', prediction: null, momentum7d: null, momentum30d: null,
            source: 'AEGIS strategy', sourceUrl: null, ourStrategy: true, warning: 'spreadNegative',
        },
        {
            id: 'rwa-pareto', name: 'Pareto Credit (USDC)', protocol: 'pareto-credit', chain: 'Ethereum',
            category: 'rwaCredit', riskTier: 'high', baseApy: 10.5, rewardApy: 0, totalApy: 10.5,
            tvlUsd: 168e6, stablecoin: true, ilRisk: 'no', prediction: { cls: 'Stable/Up', probability: 72 },
            momentum7d: 0.2, momentum30d: 0.1, source: 'DefiLlama', sourceUrl: 'https://defillama.com/yields/pool/y',
            ourStrategy: false, warning: null,
        },
    ],
    market: {
        susdeApy: 4.5, pendleApy: 6.75, morphoBorrowApy: 6, morphoSupplyApy: 4.2,
        fundingApy: -3.6, loopNetApy: -0.5, asOf: '2026-08-19T00:00:00.000Z',
    },
    benchmarks: {
        tBill: { value: 3.87, date: '2026-08-18', source: 'U.S. Treasury · FRED DGS3MO' },
        ethStaking: { value: 2.18, source: 'Lido · DefiLlama' },
        susde: { value: 4.5, source: 'Ethena sUSDe · DefiLlama' },
        usdc: { value: 0, source: 'USDC (no-yield baseline)' },
    },
};

const strategiesFixture = {
    rangeDays: 90,
    leverage: 4,
    strategies: [
        {
            strategy: 'loop', label: 'sUSDe Delta-Neutral Loop', leverage: 4, riskGrade: 'aggressive',
            days: 90, totalReturn: 12.3, cagr: 12.3, sharpe: 1.8, sortino: 2.2,
            maxDrawdown: 4.5, annualizedVolatilityPct: 14, winRate: 0.8, currentNetApy: 9.5,
        },
        {
            strategy: 'susde-stake', label: 'sUSDe Staking (Ethena)', leverage: 1, riskGrade: 'conservative',
            days: 90, totalReturn: 3.2, cagr: 3.2, sharpe: 2.4, sortino: 2.6,
            maxDrawdown: 0.5, annualizedVolatilityPct: 3, winRate: 1, currentNetApy: 4.0,
        },
    ],
};

function mockRoutes() {
    apiFetch.mockImplementation(async (url) => {
        if (String(url).startsWith('/api/backtest/sweep')) return { ok: true, json: async () => sweepFixture };
        if (String(url).startsWith('/api/backtest/monte-carlo')) return { ok: true, json: async () => mcFixture };
        if (String(url).startsWith('/api/backtest?')) return { ok: true, json: async () => backtestFixture };
        if (String(url).startsWith('/api/portfolio/metrics')) return { ok: true, json: async () => metricsFixture };
        if (String(url).startsWith('/api/analytics/strategies')) return { ok: true, json: async () => strategiesFixture };
        if (String(url).startsWith('/api/analytics/opportunities')) return { ok: true, json: async () => opportunitiesFixture };
        return { ok: true, json: async () => [] };
    });
}

describe('Analytics page', () => {
    beforeEach(() => {
        apiFetch.mockReset();
        mockRoutes();
    });

    it('renders the opportunities dashboard with benchmarks and risk labels', async () => {
        render(<Analytics />);
        await waitFor(() => {
            expect(screen.getByText('Live Opportunities')).toBeTruthy();
        });
        // Benchmark strip
        expect(screen.getByText('T-Bill (3mo)')).toBeTruthy();
        // Opportunity cards: total APY + risk badge + our-strategy tag
        expect(screen.getAllByText('+4.5%').length).toBeGreaterThan(0);
        expect(screen.getByText('Your strategy')).toBeTruthy();
        // Plain-language risk descriptors are reachable via the badge title
        expect(screen.getByText(/Pareto Credit/)).toBeTruthy();
    });

    it('renders market outlook, rate scenarios and the strategy comparison', async () => {
        render(<Analytics />);
        await waitFor(() => {
            expect(screen.getByText('Market Outlook')).toBeTruthy();
        });
        expect(screen.getByText('Rate Scenarios')).toBeTruthy();
        // Scenario net APY uses the market snapshot baseline (4.5*4 - 6*3 - 0.5 = -0.5)
        expect(screen.getAllByText('-0.5%').length).toBeGreaterThan(0);
        // Strategy comparison table
        expect(screen.getByText('Strategy Comparison')).toBeTruthy();
        expect(screen.getAllByText('sUSDe Staking (Ethena)').length).toBeGreaterThan(0);
        expect(screen.getByText('Aggressive')).toBeTruthy();
        expect(screen.getByText('Conservative')).toBeTruthy();
    });

    it('renders all four deep-dive panels and their titles', async () => {
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
        apiFetch.mockImplementation(async (url) => {
            if (String(url).startsWith('/api/backtest?')) return { ok: true, json: async () => ({ error: 'Not enough historical data to backtest.' }) };
            if (String(url).startsWith('/api/analytics/opportunities')) return { ok: true, json: async () => ({ error: 'boom' }) };
            return { ok: true, json: async () => [] };
        });
        render(<Analytics />);
        await waitFor(() => {
            expect(screen.getAllByText(/Not enough historical data/i).length).toBeGreaterThan(0);
        });
        // Opportunities error surfaces with a retry button instead of crashing
        expect(screen.getAllByText(/boom/i).length).toBeGreaterThan(0);
    });
});