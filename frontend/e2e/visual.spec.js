// Visual regression: stable, deterministic screenshots of the app shell and
// static pages. Dynamic pages (running-simulation charts fed by live WS) are
// intentionally excluded — their pixels change every cycle.
//
// Baselines live in e2e/visual-snapshots/* and are committed. Regenerate with:
//   npx playwright test e2e/visual.spec.js --update-snapshots
// CI runs these in the e2e job (Faz 4) so a stray layout/color regression
// fails the build.
import { test, expect } from '@playwright/test';

const BACKEND = 'http://localhost:3001';

// Horizontal overflow guard: the page must never scroll sideways and no element
// may poke past the right viewport edge (catches unwrapped flex rows, oversized
// metric figures and negative chart margins).
async function assertNoHorizontalOverflow(page) {
    const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const pageOverflows = doc.scrollWidth > doc.clientWidth + 1;
        const offenders = [];
        for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.right > window.innerWidth + 1 && r.width > 0 && getComputedStyle(el).position !== 'fixed') {
                offenders.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')} (right=${Math.round(r.right)})`);
            }
        }
        return { pageOverflows, offenders: offenders.slice(0, 8) };
    });
    expect(overflow.pageOverflows, `page scrollWidth > clientWidth; offenders: ${overflow.offenders.join(', ')}`).toBe(false);
}

// ---------------------------------------------------------------------------
// Analytics page fixtures. The Analytics page is entirely live-market-driven
// (DefiLlama APYs, FRED T-Bill, Morpho, historical backtest data), so its
// pixels drift whenever the real market moves. For a STABLE visual baseline we
// intercept every analytics API call and fulfill it with these fixed payloads —
// the functional crawl tests still exercise the real live data.
// ---------------------------------------------------------------------------
const OPP_FIXTURE = {
    status: 'LIVE',
    generatedAt: '2026-08-19T00:00:00.000Z',
    opportunities: [
        { id: 'susde-stake', name: 'sUSDe Staking', protocol: 'Ethena', chain: 'Ethereum', category: 'staking', riskTier: 'low', baseApy: 4.49, rewardApy: 0, totalApy: 4.49, tvlUsd: 1.3e9, stablecoin: true, ilRisk: 'no', prediction: { cls: 'Stable/Up', probability: 70 }, momentum7d: 0.2, momentum30d: -0.2, source: 'DefiLlama', sourceUrl: 'https://defillama.com/yields/pool/susde', ourStrategy: false, warning: null },
        { id: 'pendle-susde', name: 'Pendle sUSDe Fixed Yield', protocol: 'Pendle', chain: 'Ethereum', category: 'fixedYield', riskTier: 'low', baseApy: 4.53, rewardApy: 2.21, totalApy: 6.74, tvlUsd: 2.1e6, stablecoin: true, ilRisk: 'no', prediction: { cls: 'Down', probability: 58 }, momentum7d: 3.7, momentum30d: 0, source: 'DefiLlama', sourceUrl: 'https://defillama.com/yields/pool/pendle', ourStrategy: false, warning: null },
        { id: 'morpho-usdc-1', name: 'Morpho USDC Supply (Ethereum)', protocol: 'Morpho Blue', chain: 'Ethereum', symbol: 'USDC', category: 'lending', riskTier: 'low', baseApy: 6.56, rewardApy: 0, totalApy: 6.56, tvlUsd: null, stablecoin: true, ilRisk: 'no', prediction: null, momentum7d: null, momentum30d: null, source: 'Morpho Blue', sourceUrl: 'https://app.morpho.org/', ourStrategy: false, warning: null },
        { id: 'morpho-reward-vault', name: 'Morpho Boosted Vault (SENRLUSDV2)', protocol: 'Morpho Blue', chain: 'Ethereum', category: 'vault', riskTier: 'medium', baseApy: 0.4, rewardApy: 7.67, totalApy: 8.07, tvlUsd: 25.6e6, stablecoin: true, ilRisk: 'no', prediction: { cls: 'Stable/Up', probability: 59 }, momentum7d: 0.6, momentum30d: 0, source: 'DefiLlama', sourceUrl: 'https://defillama.com/yields/pool/vault', ourStrategy: false, warning: null },
        { id: 'rwa-pareto', name: 'Pareto Credit (USDC)', protocol: 'pareto-credit', chain: 'Ethereum', category: 'rwaCredit', riskTier: 'high', baseApy: 8.02, rewardApy: 0, totalApy: 8.02, tvlUsd: 168e6, stablecoin: true, ilRisk: 'no', prediction: { cls: 'Stable/Up', probability: 72 }, momentum7d: 0, momentum30d: 0, source: 'DefiLlama', sourceUrl: 'https://defillama.com/yields/pool/pareto', ourStrategy: false, warning: null },
        { id: 'rwa-apyx', name: 'Apyx Protocol (APXUSD)', protocol: 'apyx-protocol', chain: 'Ethereum', category: 'rwaCredit', riskTier: 'high', baseApy: 12.76, rewardApy: 0, totalApy: 12.76, tvlUsd: 173e6, stablecoin: true, ilRisk: 'no', prediction: { cls: 'Stable/Up', probability: 53 }, momentum7d: -0.9, momentum30d: 0, source: 'DefiLlama', sourceUrl: 'https://defillama.com/yields/pool/apyx', ourStrategy: false, warning: null },
        { id: 'funding-basis', name: 'ETH Funding Basis (ETH)', protocol: 'Hyperliquid', chain: 'Derivatives', category: 'basis', riskTier: 'medium', baseApy: -1.73, rewardApy: 0, totalApy: -1.73, tvlUsd: null, stablecoin: false, ilRisk: 'yes', prediction: null, momentum7d: null, momentum30d: null, trendApy7d: -2.1, source: 'Hyperliquid', sourceUrl: 'https://app.hyperliquid.xyz/', ourStrategy: false, warning: 'fundingNegative' },
        { id: 'delta-neutral-loop', name: 'sUSDe Delta-Neutral Loop', protocol: 'AEGIS', chain: 'Ethereum', category: 'deltaNeutral', riskTier: 'high', baseApy: -4.32, rewardApy: 0, totalApy: -4.32, tvlUsd: null, stablecoin: true, ilRisk: 'no', prediction: null, momentum7d: null, momentum30d: null, source: 'AEGIS strategy', sourceUrl: null, ourStrategy: true, warning: 'spreadNegative' },
    ],
    market: { susdeApy: 4.49, pendleApy: 6.74, morphoBorrowApy: 7.26, morphoSupplyApy: 6.56, fundingApy: -1.73, loopNetApy: -4.32, asOf: '2026-08-19T00:00:00.000Z' },
    benchmarks: {
        tBill: { value: 3.87, date: '2026-08-17', source: 'U.S. Treasury · FRED DGS3MO' },
        ethStaking: { value: 2.18, source: 'Lido · DefiLlama' },
        susde: { value: 4.49, source: 'Ethena sUSDe · DefiLlama' },
        usdc: { value: 0, source: 'USDC (no-yield baseline)' },
    },
};

const STRATEGIES_FIXTURE = {
    rangeDays: 90, leverage: 4, gasImpactApy: 0.5, generatedAt: '2026-08-19T00:00:00.000Z',
    strategies: [
        { strategy: 'pendle', label: 'Pendle sUSDe Fixed Yield', leverage: 1, riskGrade: 'conservative', days: 90, totalReturn: 4.8, cagr: 4.8, sharpe: 2.4, sortino: 2.6, maxDrawdown: 0.2, annualizedVolatilityPct: 2.1, winRate: 1, currentNetApy: 6.24 },
        { strategy: 'morpho-supply', label: 'Morpho USDC Supply', leverage: 1, riskGrade: 'conservative', days: 90, totalReturn: 4.6, cagr: 4.6, sharpe: 2.2, sortino: 2.4, maxDrawdown: 0.3, annualizedVolatilityPct: 2.4, winRate: 1, currentNetApy: 5.84 },
        { strategy: 'susde-stake', label: 'sUSDe Staking (Ethena)', leverage: 1, riskGrade: 'conservative', days: 90, totalReturn: 3.2, cagr: 3.2, sharpe: 1.9, sortino: 2.0, maxDrawdown: 0.4, annualizedVolatilityPct: 2.0, winRate: 1, currentNetApy: 4.08 },
        { strategy: 'loop', label: 'sUSDe Delta-Neutral Loop', leverage: 4, riskGrade: 'aggressive', days: 90, totalReturn: -1.3, cagr: -1.3, sharpe: -0.6, sortino: -0.8, maxDrawdown: 1.2, annualizedVolatilityPct: 6.4, winRate: 0.7, currentNetApy: -0.83 },
    ],
};

const BACKTEST_FIXTURE = {
    strategy: 'Pendle PT-sUSDe Delta-Neutral Loop', rangeDays: 90, leverage: 4, gasImpactApy: 0.5, riskFreeRatePct: 0, days: 90,
    totalReturn: 5.2, cagr: 5.2, sharpe: 1.31, maxDrawdown: 1.2, sortino: 1.55, annualizedVolatilityPct: 6.4, vaR95Pct: 0.42, cVaR95Pct: 0.61, winRate: 0.72,
    startDate: '2026-05-21', endDate: '2026-08-18',
    last: { date: '2026-08-18', susdeApy: 4.49, borrowApy: 7.03, loopNetApy: -0.83 },
    monthly: [
        { month: '2026-05', returnPct: 0.9, netApy: 3.2 },
        { month: '2026-06', returnPct: 1.4, netApy: 4.1 },
        { month: '2026-07', returnPct: 1.1, netApy: 3.6 },
        { month: '2026-08', returnPct: -0.2, netApy: 1.8 },
    ],
    equityCurve: [
        { date: '2026-06-01', equity: 1.0006 }, { date: '2026-06-03', equity: 1.0022 },
        { date: '2026-06-05', equity: 1.004 }, { date: '2026-06-07', equity: 1.0054 },
        { date: '2026-06-09', equity: 1.0063 }, { date: '2026-06-11', equity: 1.0069 },
        { date: '2026-06-13', equity: 1.0078 }, { date: '2026-06-15', equity: 1.0093 },
        { date: '2026-06-17', equity: 1.0111 }, { date: '2026-06-19', equity: 1.0127 },
        { date: '2026-06-21', equity: 1.0137 }, { date: '2026-06-23', equity: 1.0143 },
    ],
};

const MC_FIXTURE = {
    strategy: 'Pendle PT-sUSDe Delta-Neutral Loop (Monte Carlo)', simulations: 1000, days: 90, leverage: 4,
    liquidationPriceAtLeverage: 0.7979, liquidationProbability: 0.018, medianReturnPct: 5.1, p5ReturnPct: -6.2, p95ReturnPct: 17.4, meanReturnPct: 5.4,
    distribution: [
        { bucket: -10, lower: -15, upper: -5, count: 60 },
        { bucket: 0, lower: -5, upper: 5, count: 240 },
        { bucket: 5, lower: 5, upper: 10, count: 330 },
        { bucket: 10, lower: 10, upper: 15, count: 220 },
        { bucket: 15, lower: 15, upper: 20, count: 110 },
        { bucket: 20, lower: 20, upper: 25, count: 40 },
    ],
};

const SWEEP_FIXTURE = [
    { leverage: 2, cagr: 2.6, sharpe: 1.9, maxDrawdown: 0.3, days: 90 },
    { leverage: 3, cagr: 3.9, sharpe: 1.5, maxDrawdown: 0.6, days: 90 },
    { leverage: 4, cagr: 5.2, sharpe: 1.3, maxDrawdown: 1.2, days: 90 },
    { leverage: 5, cagr: 6.4, sharpe: 1.1, maxDrawdown: 1.9, days: 90 },
    { leverage: 6, cagr: 7.6, sharpe: 1.0, maxDrawdown: 2.8, days: 90 },
];

const METRICS_FIXTURE = {
    periods: 60, sharpeRatio: 1.2, sortinoRatio: 1.4, annualizedVolatilityPct: 8, maxDrawdownPct: 1.5,
    calmarRatio: 3.1, tailRatio: 1.7, winRate: 0.7, lastNetApy: 3.4, lastTvl: 120000,
    equityCurve: [
        { i: 0, equity: 1 }, { i: 5, equity: 1.01 }, { i: 10, equity: 1.02 },
        { i: 15, equity: 1.025 }, { i: 20, equity: 1.04 }, { i: 25, equity: 1.05 },
    ],
    returnHistogram: [
        { bucket: -0.4, lower: -0.6, upper: -0.2, count: 40 },
        { bucket: -0.1, lower: -0.2, upper: 0, count: 120 },
        { bucket: 0.1, lower: 0, upper: 0.2, count: 260 },
        { bucket: 0.3, lower: 0.2, upper: 0.4, count: 300 },
        { bucket: 0.5, lower: 0.4, upper: 0.6, count: 180 },
        { bucket: 0.7, lower: 0.6, upper: 0.8, count: 70 },
    ],
    rollingVolatility: [
        { i: 30, volPct: 9.9 }, { i: 36, volPct: 8.8 }, { i: 42, volPct: 6.2 },
        { i: 48, volPct: 6.9 }, { i: 54, volPct: 9.6 }, { i: 59, volPct: 9.6 },
    ],
};

async function mockAnalyticsApi(page) {
    await page.route('**/api/backtest/monte-carlo*', r => r.fulfill({ json: MC_FIXTURE }));
    await page.route('**/api/backtest/sweep*', r => r.fulfill({ json: SWEEP_FIXTURE }));
    await page.route('**/api/backtest?*', r => r.fulfill({ json: BACKTEST_FIXTURE }));
    await page.route('**/api/analytics/opportunities*', r => r.fulfill({ json: OPP_FIXTURE }));
    await page.route('**/api/analytics/strategies*', r => r.fulfill({ json: STRATEGIES_FIXTURE }));
    await page.route('**/api/portfolio/metrics*', r => r.fulfill({ json: METRICS_FIXTURE }));
}

test.describe('Visual regression', () => {
    test.use({ baseURL: 'http://localhost:5173' });

    test.beforeEach(async ({ request }) => {
        await request.post(`${BACKEND}/api/auth/login`, {
            data: { username: 'local', password: 'AegisAdmin123' },
        }).catch(() => {});
        // Determinism: stop + delete any simulation left by the functional
        // specs, so pages render their static idle/empty state (the live-data
        // page otherwise shows live prices/timestamps that shift every run).
        // Deleting a simulation cascades its settings row, so re-seed a fixed
        // settings state afterwards — otherwise the settings page height
        // flips between SIM (scenario select visible) and LIVE.
        await request.post(`${BACKEND}/api/simulation/stop`).catch(() => {});
        const list = await request.get(`${BACKEND}/api/simulations`).then(r => r.json()).catch(() => []);
        for (const sim of Array.isArray(list) ? list : []) {
            await request.delete(`${BACKEND}/api/simulation/${sim.id}`).catch(() => {});
        }
        await request.post(`${BACKEND}/api/settings`, {
            data: {
                dataMode: 'SIM',
                dataScenario: 'stable',
                rpcUrl: 'https://e2e-sepolia.invalid',
                openRouterKey: 'sk-or-e2e-placeholder',
                activeModel: 'google/gemini-2.5-flash-exp:free',
                brainMode: 'auto',
                riskAppetite: 'Balanced',
                frequency: 'Medium',
                targetHf: 1.25,
                maxGasClaim: 20,
            },
        }).catch(() => {});
    });

    test('live data page renders consistently', async ({ page }) => {
        await page.goto('/live-data');
        await expect(page.getByText(/Live Oracle Feed/i).first()).toBeVisible({ timeout: 15000 });
        // Wait for the WS status pill to settle on a definitive state — the
        // LIVE/OFFLINE badge flips while the socket connects, which would make
        // the screenshot non-deterministic across runs.
        await expect(page.locator('span', { hasText: /^(LIVE|OFFLINE)$/ }).first()).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveScreenshot('live-data.png', { maxDiffPixelRatio: 0.02 });
        await assertNoHorizontalOverflow(page);
    });

    test('overview idle state renders consistently', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('button', { name: /Start New/i }).first()).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveScreenshot('overview-idle.png', { maxDiffPixelRatio: 0.02 });
        await assertNoHorizontalOverflow(page);
    });

    test('settings page renders consistently', async ({ page }) => {
        await page.goto('/settings');
        // Heading role skips the (hidden-on-mobile) sidebar nav links.
        await expect(page.getByRole('heading', { name: /Settings|Ayarlar/i }).first()).toBeVisible({ timeout: 15000 });
        // Full-page: the Brain Mode card sits below the 720px fold, and a
        // viewport-only shot would never catch a regression in it.
        await expect(page).toHaveScreenshot('settings.png', { maxDiffPixelRatio: 0.02, fullPage: true });
        await assertNoHorizontalOverflow(page);
    });

    test('yield strategies page renders consistently', async ({ page }) => {
        await page.goto('/yield-strategies');
        await expect(page.getByRole('heading', { name: /Yield Strategies|Getiri Stratejileri/i }).first()).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveScreenshot('yield-strategies.png', { maxDiffPixelRatio: 0.02 });
        await assertNoHorizontalOverflow(page);
    });

    test('analytics page renders consistently', async ({ page }) => {
        // Fixed payloads make the live-market-driven page pixel-stable across
        // runs and CI (real APYs drift every time the market moves).
        await mockAnalyticsApi(page);
        await page.goto('/analytics');
        await expect(page.getByText(/Strategy Analytics/i).first()).toBeVisible({ timeout: 15000 });
        // Wait for the opportunities dashboard (hero) to render its content and
        // for every panel to finish its fetch (spinners gone) so the screenshot
        // captures settled data/error states, not mid-load frames.
        await expect(page.getByText(/Live Opportunities|Canlı Fırsatlar/i).first()).toBeVisible({ timeout: 20000 });
        await expect(page.locator('.animate-spin')).toHaveCount(0, { timeout: 25000 });
        await expect(page).toHaveScreenshot('analytics.png', { maxDiffPixelRatio: 0.02, fullPage: true });
        await assertNoHorizontalOverflow(page);
    });
});