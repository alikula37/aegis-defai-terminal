import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Backtester } from '../backtest/Backtester.js';

const MOCK_POOL = (overrides = {}) => ({
    pool: 'pool-1',
    project: 'ethena-usde',
    symbol: 'SUSDE',
    chain: 'Ethereum',
    apy: 4.5,
    apyBase: 4.5,
    apyReward: null,
    tvlUsd: 1.3e9,
    stablecoin: true,
    ilRisk: 'no',
    apyPct7D: 0.1,
    apyPct30D: -0.2,
    predictions: { predictedClass: 'Stable/Up', predictedProbability: 71 },
    ...overrides,
});

const poolList = () => [
    MOCK_POOL({ pool: '66985a81-9c51-46ca-9977-42b4fe7bc6df', project: 'ethena-usde', symbol: 'SUSDE', apy: 4.5 }),
    MOCK_POOL({ pool: 'afdef3b3-8c37-5156-9c39-c2849e20f7a8', project: 'pendle', symbol: 'SUSDE', apy: 6.75, tvlUsd: 15.8e6 }),
    MOCK_POOL({ pool: 'lido-steth', project: 'lido', symbol: 'STETH', chain: 'Ethereum', apy: 2.18, tvlUsd: 18e9 }),
    MOCK_POOL({ pool: 'aave-usdc', project: 'aave-v3', symbol: 'USDC', chain: 'Ethereum', apy: 3.28, tvlUsd: 185e6, stablecoin: true }),
    MOCK_POOL({ pool: 'morpho-vault', project: 'morpho-blue', symbol: 'SENRLUSDV2', apy: 6.66, apyBase: 2.98, apyReward: 3.68, tvlUsd: 316e6, stablecoin: true }),
    MOCK_POOL({ pool: 'pareto', project: 'pareto-credit', symbol: 'USDC', apy: 10.5, tvlUsd: 168e6, stablecoin: true }),
    MOCK_POOL({ pool: 'midas', project: 'midas-rwa', symbol: 'USDC', apy: 10.0, tvlUsd: 72e6, stablecoin: true }),
    MOCK_POOL({ pool: 'tori', project: 'tori-finance', symbol: 'STRUSD', apy: 11.0, tvlUsd: 45e6, stablecoin: true }),
    MOCK_POOL({ pool: 'apyx', project: 'apyx-protocol', symbol: 'APXUSD', apy: 12.7, tvlUsd: 173e6, stablecoin: true }),
];

function stubOracle() {
    vi.mock('../services/OracleService.js', () => ({
        OracleService: {
            fetchRawData: vi.fn(async () => ({ pricesData: {}, yieldsData: { data: poolList() }, status: 'LIVE' })),
            getMorphoUsdcRates: vi.fn(async () => ({ borrowApy: 6, supplyApy: 4.2, marketId: 'mkt' })),
            getFundingRates: vi.fn(async () => Array.from({ length: 168 }, (_, i) => ({ time: 1700000000000 + i * 3600000, fundingRate: 0.000012 }))),
            clearCaches: vi.fn(),
        },
    }));
    // T-Bill: stub global fetch for the FRED endpoint only.
    vi.stubGlobal('fetch', vi.fn(async (url, _opts) => {
        if (typeof url === 'string' && url.includes('fred.stlouisfed.org')) {
            return { ok: true, text: async () => 'DATE,VALUE\n2026-08-17,3.87\n2026-08-18,3.88\n' };
        }
        throw new Error(`Unexpected fetch: ${url}`);
    }));
}

function stubHistorical() {
    vi.mock('../services/HistoricalDataService.js', () => ({
        HistoricalDataService: {
            getPoolApyHistory: vi.fn(async (id, symbol, range) => {
                const out = [];
                const start = new Date('2026-01-01T00:00:00Z');
                for (let i = 0; i < range; i++) {
                    const d = new Date(start);
                    d.setDate(d.getDate() + i);
                    out.push({ timestamp: d.toISOString(), apy: 5 + 0.3 * Math.sin(i) });
                }
                return out;
            }),
            getSupplyRateHistory: vi.fn(async () => {
                const out = [];
                const start = new Date('2026-01-01T00:00:00Z');
                for (let i = 0; i < 90; i++) {
                    const d = new Date(start);
                    d.setDate(d.getDate() + i);
                    out.push({ time: Math.floor(d.getTime() / 1000), supplyApy: 4 + 0.2 * Math.cos(i) });
                }
                return out;
            }),
            buildBacktestDataset: vi.fn(async (range) => {
                const out = [];
                const start = new Date('2026-01-01T00:00:00Z');
                for (let i = 0; i < range; i++) {
                    const d = new Date(start);
                    d.setDate(d.getDate() + i);
                    out.push({ date: d.toISOString().slice(0, 10), susdeApy: 5 + 0.3 * Math.sin(i), borrowApy: 4, fundingApy: 0 });
                }
                return out;
            }),
        },
    }));
}

describe('AnalyticsService', () => {
    beforeEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
        stubOracle();
        stubHistorical();
    });
    afterEach(() => {
        vi.resetModules();
        vi.unstubAllGlobals();
    });

    describe('getBenchmarks', () => {
        it('returns live T-Bill, ETH staking and sUSDe benchmarks', async () => {
            const { OracleService } = await import('../services/OracleService.js');
            const svc = (await import('../services/AnalyticsService.js')).AnalyticsService;
            svc.clearCaches();
            const b = await svc.getBenchmarks();
            expect(b.tBill.value).toBeCloseTo(3.88, 5);
            expect(b.tBill.source).toContain('FRED');
            expect(b.ethStaking.value).toBeCloseTo(2.18, 5);
            expect(b.susde.value).toBeCloseTo(4.5, 5);
            expect(b.usdc.value).toBe(0);
            expect(OracleService.fetchRawData).toHaveBeenCalled();
        });

        it('falls back to a documented constant when FRED fails', async () => {
            vi.stubGlobal('fetch', vi.fn(async (url) => {
                if (typeof url === 'string' && url.includes('fred.stlouisfed.org')) {
                    return { ok: false, text: async () => '' };
                }
                throw new Error('boom');
            }));
            const svc = (await import('../services/AnalyticsService.js')).AnalyticsService;
            svc.clearCaches();
            const b = await svc.getBenchmarks();
            expect(b.tBill.value).toBe(4.2);
        });
    });

    describe('getOpportunities', () => {
        it('builds a broad, risk-labeled opportunity list with benchmarks', async () => {
            const svc = (await import('../services/AnalyticsService.js')).AnalyticsService;
            svc.clearCaches();
            const d = await svc.getOpportunities();
            expect(d.status).toBe('LIVE');
            expect(Array.isArray(d.opportunities)).toBe(true);

            const ids = new Set(d.opportunities.map(o => o.id));
            // Core universe present
            for (const id of ['susde-stake', 'pendle-susde', 'morpho-usdc-1', 'aave-usdc-eth', 'morpho-reward-vault', 'delta-neutral-loop', 'funding-basis', 'rwa-pareto']) {
                expect(ids.has(id), `missing ${id}`).toBe(true);
            }
            // Risk tiers are explicit and understood
            expect(d.opportunities.every(o => ['low', 'medium', 'high'].includes(o.riskTier))).toBe(true);
            // Our loop is flagged and carries structured numbers
            const loop = d.opportunities.find(o => o.id === 'delta-neutral-loop');
            expect(loop.ourStrategy).toBe(true);
            expect(loop.totalApy).toBeCloseTo(4.5 * 4 - 6 * 3 - 0.5, 5); // ~ -0.5 with current mocks
            // RWA entries are high-risk
            expect(d.opportunities.find(o => o.id === 'rwa-pareto').riskTier).toBe('high');
            // DefiLlama prediction carried through
            expect(d.opportunities.find(o => o.id === 'susde-stake').prediction.cls).toBe('Stable/Up');
            // Market snapshot + benchmarks attached
            expect(d.market.loopNetApy).toBeCloseTo(loop.totalApy, 5);
            expect(d.benchmarks.tBill.value).toBeGreaterThan(0);
        });

        it('caches the expensive payload', async () => {
            const svc = (await import('../services/AnalyticsService.js')).AnalyticsService;
            const { OracleService } = await import('../services/OracleService.js');
            svc.clearCaches();
            await svc.getOpportunities();
            const afterFirst = OracleService.fetchRawData.mock.calls.length;
            expect(afterFirst).toBeGreaterThanOrEqual(2); // opportunities + benchmarks
            await svc.getOpportunities();
            expect(OracleService.fetchRawData.mock.calls.length).toBe(afterFirst);
        });
    });

    describe('getStrategyComparison', () => {
        it('returns a sorted comparison of all strategies with metrics', async () => {
            const svc = (await import('../services/AnalyticsService.js')).AnalyticsService;
            const c = await svc.getStrategyComparison({ rangeDays: 90, leverage: 4 });
            expect(c.strategies.length).toBe(4);
            const ids = c.strategies.map(s => s.strategy);
            for (const id of ['susde-stake', 'pendle', 'morpho-supply', 'loop']) {
                expect(ids).toContain(id);
            }
            // Sorted by CAGR descending (best first, no errors)
            const cagrs = c.strategies.map(s => s.cagr);
            expect([...cagrs].sort((a, b) => b - a)).toEqual(cagrs);
            for (const s of c.strategies) {
                expect(['conservative', 'balanced', 'aggressive']).toContain(s.riskGrade);
                expect(Number.isFinite(s.cagr)).toBe(true);
                expect(Number.isFinite(s.sharpe)).toBe(true);
                expect(s.days).toBe(90);
            }
        });
    });
});

describe('Backtester.runStrategySeries', () => {
    it('compounds an arbitrary net-APY series and reports metrics', () => {
        const daily = Array.from({ length: 90 }, (_, i) => 5 + 0.5 * Math.sin(i));
        const start = new Date('2026-01-01T00:00:00Z');
        const dates = Array.from({ length: 90 }, (_, i) => {
            const d = new Date(start);
            d.setDate(d.getDate() + i);
            return d.toISOString().slice(0, 10);
        });
        const r = Backtester.runStrategySeries({ dailyNetApy: daily, dates, leverage: 1 });
        expect(r.error).toBeUndefined();
        expect(r.days).toBe(90);
        expect(r.currentNetApy).toBeCloseTo(daily[daily.length - 1], 5);
        expect(r.totalReturn).toBeGreaterThan(0);
        expect(Array.isArray(r.equityCurve)).toBe(true);
        expect(r.equityCurve.length).toBe(90);
        expect(r.monthly.length).toBeGreaterThanOrEqual(2); // spans Jan + Feb/Mar
        expect(r.outOfSample.testDays).toBe(18); // last 20% of 90
    });

    it('rejects series with fewer than 7 usable days', () => {
        const r = Backtester.runStrategySeries({ dailyNetApy: [1, 2, 3], dates: ['a', 'b', 'c'] });
        expect(r.error).toContain('Not enough');
    });
});
