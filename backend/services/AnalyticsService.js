import { OracleService } from './OracleService.js';
import { HistoricalDataService } from './HistoricalDataService.js';
import { Backtester, loopNetApy } from '../backtest/Backtester.js';
import config from '../aegis.config.js';

// The opportunities payload is expensive to build (full DefiLlama pool list +
// Morpho + funding), so cache it server-side. The yield list itself is already
// cached for 5 min inside OracleService; 15 min here keeps the Analytics page
// snappy without ever going stale in a meaningful way.
const OPP_CACHE_TTL_MS = 15 * 60 * 1000;
const FRED_TTL_MS = 12 * 3600000; // T-Bill moves daily, no need to refetch hourly

let oppCache = { data: null, fetchedAt: 0 };
let tbillCache = { data: null, fetchedAt: 0 };

function isFresh(cache, ttl) {
    return !!(cache && cache.data && (Date.now() - cache.fetchedAt < ttl));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}

const round2 = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

// Curated RWA / private-credit projects shown as higher-yield (and higher-risk)
// opportunities. Each entry resolves to the largest stablecoin pool DefiLlama
// lists for the project. Risk labels are explicit so the UI can warn the user.
const RWA_SPOTLIGHTS = [
    ['pareto-credit', 'rwa-pareto', 'Pareto Credit'],
    ['midas-rwa', 'rwa-midas', 'Midas RWA'],
    ['tori-finance', 'rwa-tori', 'Tori Finance'],
    ['apyx-protocol', 'rwa-apyx', 'Apyx Protocol'],
];

/** Map a DefiLlama pool row into a normalized opportunity object. */
function poolToOpportunity(pool, meta) {
    const apy = pool.apy ?? 0;
    const baseApy = pool.apyBase ?? apy;
    const rewardApy = pool.apyReward ?? Math.max(0, apy - baseApy);
    return {
        id: meta.id,
        name: meta.name || `${pool.project} · ${pool.symbol}`,
        protocol: meta.protocol || pool.project,
        chain: pool.chain,
        symbol: pool.symbol,
        category: meta.category,
        riskTier: meta.riskTier,
        baseApy: round2(baseApy),
        rewardApy: round2(rewardApy),
        totalApy: round2(apy),
        tvlUsd: round2(pool.tvlUsd ?? 0),
        stablecoin: !!pool.stablecoin,
        ilRisk: pool.ilRisk || 'no',
        prediction: pool.predictions?.predictedClass
            ? { cls: pool.predictions.predictedClass, probability: pool.predictions.predictedProbability }
            : null,
        momentum7d: pool.apyPct7D ?? null,
        momentum30d: pool.apyPct30D ?? null,
        source: 'DefiLlama',
        sourceUrl: `https://defillama.com/yields/pool/${pool.pool}`,
        ourStrategy: !!meta.ourStrategy,
        warning: meta.warning || null,
    };
}

/**
 * Analytics data service: live yield opportunities, benchmarks (FRED T-Bill,
 * ETH staking) and a cross-strategy historical comparison. All read-only,
 * cached, and resilient to upstream API failures.
 */
export class AnalyticsService {
    static clearCaches() {
        oppCache = { data: null, fetchedAt: 0 };
        tbillCache = { data: null, fetchedAt: 0 };
    }

    /** Live US 3-month T-Bill constant maturity from FRED (no API key needed). */
    static async getTBill() {
        if (isFresh(tbillCache, FRED_TTL_MS)) return tbillCache.data;
        const res = await fetchWithTimeout('https://fred.stlouisfed.org/graph/fredgraph.csv?id=DGS3MO', {}, 10000);
        if (!res.ok) throw new Error('FRED fetch failed');
        const text = await res.text();
        const lines = text.trim().split('\n').filter(Boolean);
        const last = lines[lines.length - 1]?.split(',') || [];
        const value = parseFloat(last[1]);
        if (!Number.isFinite(value)) throw new Error('FRED parse failed');
        const data = { value, date: last[0] || null, source: 'U.S. Treasury · FRED DGS3MO' };
        tbillCache = { data, fetchedAt: Date.now() };
        return data;
    }

    /** Current benchmarks: T-Bill, ETH staking (Lido), sUSDe, USDC baseline. */
    static async getBenchmarks() {
        const tBill = await this.getTBill()
            .catch(() => ({ value: 4.2, date: null, source: 'U.S. Treasury · FRED DGS3MO (fallback)' }));
        const { yieldsData } = await OracleService.fetchRawData();
        const pools = yieldsData.data;
        const lido = pools.find(p => p.project === 'lido' && p.symbol === 'STETH' && p.chain === 'Ethereum');
        const susdePool = pools.find(p => p.pool === config.marketData.pools.susde);
        return {
            tBill,
            ethStaking: { value: lido?.apy ?? null, source: 'Lido · DefiLlama' },
            susde: { value: susdePool?.apy ?? null, source: 'Ethena sUSDe · DefiLlama' },
            usdc: { value: 0, source: 'USDC (no-yield baseline)' },
        };
    }

    /**
     * Ranked live yield opportunities across the (broad, risk-labeled) universe:
     * our own delta-neutral loop + Ethena/Pendle/Morpho/Aave + RWA credit.
     */
    static async getOpportunities() {
        if (isFresh(oppCache, OPP_CACHE_TTL_MS)) return oppCache.data;

        const { yieldsData, status } = await OracleService.fetchRawData();
        const pools = yieldsData.data;
        const byId = new Map(pools.map(p => [p.pool, p]));
        const opportunities = [];
        const market = {
            susdeApy: null, pendleApy: null, morphoBorrowApy: null, morphoSupplyApy: null,
            fundingApy: null, loopNetApy: null, asOf: new Date().toISOString(),
        };

        const susde = byId.get(config.marketData.pools.susde);
        const pendle = byId.get(config.marketData.pools.pendleSusde);
        market.susdeApy = round2(susde?.apy ?? null);
        market.pendleApy = round2(pendle?.apy ?? null);

        // Direct staking + fixed yield
        if (susde) opportunities.push(poolToOpportunity(susde, {
            id: 'susde-stake', name: 'sUSDe Staking', protocol: 'Ethena',
            category: 'staking', riskTier: 'low',
        }));
        if (pendle) opportunities.push(poolToOpportunity(pendle, {
            id: 'pendle-susde', name: 'Pendle sUSDe Fixed Yield', protocol: 'Pendle',
            category: 'fixedYield', riskTier: 'low',
        }));

        // Morpho USDC supply across chains (live from Morpho GraphQL)
        for (const chainId of [1, 8453, 42161]) {
            try {
                const r = await OracleService.getMorphoUsdcRates(chainId, config.marketData.usdcAddresses[chainId]);
                if (r?.supplyApy > 0) {
                    opportunities.push({
                        id: `morpho-usdc-${chainId}`,
                        name: `Morpho USDC Supply (${chainName(chainId)})`,
                        protocol: 'Morpho Blue',
                        chain: chainName(chainId),
                        symbol: 'USDC',
                        category: 'lending',
                        riskTier: 'low',
                        baseApy: round2(r.supplyApy),
                        rewardApy: 0,
                        totalApy: round2(r.supplyApy),
                        tvlUsd: null,
                        stablecoin: true,
                        ilRisk: 'no',
                        prediction: null,
                        momentum7d: null,
                        momentum30d: null,
                        source: 'Morpho Blue',
                        sourceUrl: 'https://app.morpho.org/',
                        ourStrategy: false,
                        warning: null,
                    });
                    if (chainId === 1) market.morphoBorrowApy = round2(r.borrowApy);
                    if (chainId === 1) market.morphoSupplyApy = round2(r.supplyApy);
                }
            } catch {
                // A chain being unreachable must not fail the whole dashboard.
            }
        }

        // Aave USDC (largest stable pool)
        const aaveUsdc = pools
            .filter(p => p.project === 'aave-v3' && p.symbol === 'USDC' && p.chain === 'Ethereum' && p.stablecoin)
            .sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))[0];
        if (aaveUsdc) opportunities.push(poolToOpportunity(aaveUsdc, {
            id: 'aave-usdc-eth', name: 'Aave USDC Supply', protocol: 'Aave V3',
            category: 'lending', riskTier: 'low',
        }));

        // Morpho reward-boosted vault (best APY among sizable stablecoin vaults)
        const morphoVault = pools
            .filter(p => p.project === 'morpho-blue' && p.stablecoin && (p.apyReward || 0) > 0 && (p.tvlUsd || 0) > 20e6)
            .sort((a, b) => (b.apy || 0) - (a.apy || 0))[0];
        if (morphoVault) opportunities.push(poolToOpportunity(morphoVault, {
            id: 'morpho-reward-vault', name: `Morpho Boosted Vault (${morphoVault.symbol})`,
            protocol: 'Morpho Blue', category: 'vault', riskTier: 'medium',
        }));

        // RWA / private credit spotlights (explicit high-risk labeling)
        for (const [proj, id, label] of RWA_SPOTLIGHTS) {
            const pool = pools
                .filter(p => p.project === proj && p.stablecoin && (p.tvlUsd || 0) > 5e6)
                .sort((a, b) => (b.tvlUsd || 0) - (a.tvlUsd || 0))[0];
            if (pool) opportunities.push(poolToOpportunity(pool, {
                id, name: `${label} (${pool.symbol})`, protocol: proj,
                category: 'rwaCredit', riskTier: 'high',
            }));
        }

        // Hyperliquid ETH funding (basis). Forward-fill the last week's average
        // as a trend so the UI can say "7d avg" even when funding is negative.
        let fundingApy = 0;
        let fundingTrendApy = null;
        try {
            const funding = await OracleService.getFundingRates(config.marketData.fundingCoin, 24 * 7);
            if (funding.length) {
                fundingApy = funding[funding.length - 1].fundingRate * 8760 * 100;
                const week = funding.slice(-168);
                fundingTrendApy = week.reduce((a, b) => a + b.fundingRate, 0) / week.length * 8760 * 100;
            }
        } catch {
            // Funding is a nice-to-have; never block the dashboard on it.
        }
        market.fundingApy = round2(fundingApy);
        opportunities.push({
            id: 'funding-basis',
            name: `ETH Funding Basis (${config.marketData.fundingCoin})`,
            protocol: 'Hyperliquid',
            chain: 'Derivatives',
            symbol: config.marketData.fundingCoin,
            category: 'basis',
            riskTier: 'medium',
            baseApy: round2(fundingApy),
            rewardApy: 0,
            totalApy: round2(fundingApy),
            tvlUsd: null,
            stablecoin: false,
            ilRisk: 'yes',
            prediction: null,
            momentum7d: null,
            momentum30d: null,
            trendApy7d: round2(fundingTrendApy),
            source: 'Hyperliquid',
            sourceUrl: 'https://app.hyperliquid.xyz/',
            ourStrategy: false,
            warning: fundingApy < 0 ? 'fundingNegative' : null,
        });

        // Our own delta-neutral loop, computed from the live components
        // (sUSDe APY, Morpho borrow APY, constant gas cost).
        const lev = 4;
        const gas = 0.5;
        const borrow = market.morphoBorrowApy ?? 6;
        const susdeNow = market.susdeApy ?? 4.5;
        const loopNetApy = susdeNow * lev - borrow * (lev - 1) - gas;
        market.loopNetApy = round2(loopNetApy);
        opportunities.push({
            id: 'delta-neutral-loop',
            name: 'sUSDe Delta-Neutral Loop',
            protocol: 'AEGIS',
            chain: 'Ethereum',
            symbol: 'sUSDe',
            category: 'deltaNeutral',
            riskTier: 'high',
            baseApy: round2(loopNetApy),
            rewardApy: 0,
            totalApy: round2(loopNetApy),
            tvlUsd: null,
            stablecoin: true,
            ilRisk: 'no',
            prediction: null,
            momentum7d: null,
            momentum30d: null,
            source: 'AEGIS strategy',
            sourceUrl: null,
            ourStrategy: true,
            warning: loopNetApy < 1 ? 'spreadNegative' : loopNetApy < 4 ? 'spreadThin' : null,
        });

        const data = {
            status,
            generatedAt: new Date().toISOString(),
            opportunities,
            market,
            benchmarks: await this.getBenchmarks(),
        };
        oppCache = { data, fetchedAt: Date.now() };
        return data;
    }

    /**
     * Historical comparison across the strategy universe for a horizon and (for
     * the loop) a leverage level. Each row is a full backtest metric report.
     */
    static async getStrategyComparison({ rangeDays = 90, leverage = 4 } = {}) {
        const gasImpactApy = 0.5;
        const [susdeSeries, pendleSeries, morphoSupplySeries, loopDataset] = await Promise.all([
            HistoricalDataService.getPoolApyHistory(config.marketData.pools.susde, 'susde', rangeDays),
            HistoricalDataService.getPoolApyHistory(config.marketData.pools.pendleSusde, 'pendle-susde', rangeDays),
            HistoricalDataService.getSupplyRateHistory(1, config.marketData.usdcAddresses[1], 'eth-usdc-supply', rangeDays),
            HistoricalDataService.buildBacktestDataset(rangeDays),
        ]);

        const toNet = (points, valueFn) => points
            .map(p => ({
                date: p.time
                    ? new Date(p.time * 1000).toISOString().slice(0, 10)
                    : (p.timestamp || p.date || '').slice(0, 10),
                net: valueFn(p),
            }))
            .filter(d => d.date && Number.isFinite(d.net));

        const definitions = [
            {
                strategy: 'susde-stake', label: 'sUSDe Staking (Ethena)', riskGrade: 'conservative', leverage: 1,
                series: toNet(susdeSeries, p => (p.apy || 0) - gasImpactApy),
            },
            {
                strategy: 'pendle', label: 'Pendle sUSDe Fixed Yield', riskGrade: 'conservative', leverage: 1,
                series: toNet(pendleSeries, p => (p.apy || 0) - gasImpactApy),
            },
            {
                strategy: 'morpho-supply', label: 'Morpho USDC Supply', riskGrade: 'conservative', leverage: 1,
                series: toNet(morphoSupplySeries, p => (p.supplyApy || 0) - gasImpactApy),
            },
            {
                strategy: 'loop', label: 'sUSDe Delta-Neutral Loop', riskGrade: 'aggressive', leverage,
                series: toNet(loopDataset, p => loopNetApy(p.susdeApy, p.borrowApy, leverage) - gasImpactApy),
            },
        ];

        const strategies = definitions.map(def => {
            const result = Backtester.runStrategySeries({
                dailyNetApy: def.series.map(x => x.net),
                dates: def.series.map(x => x.date),
                leverage: def.leverage,
                gasImpactApy,
                seed: 42,
            });
            if (result.error) {
                return {
                    strategy: def.strategy, label: def.label, leverage: def.leverage,
                    riskGrade: def.riskGrade, error: result.error, days: result.days,
                };
            }
            const dd = Math.abs(result.maxDrawdown || 0);
            const riskGrade = dd > 25 ? 'aggressive' : dd > 8 ? 'balanced' : def.riskGrade;
            return {
                strategy: def.strategy,
                label: def.label,
                leverage: def.leverage,
                riskGrade,
                days: result.days,
                totalReturn: result.totalReturn,
                cagr: result.cagr,
                sharpe: result.sharpe,
                sortino: result.sortino,
                maxDrawdown: result.maxDrawdown,
                annualizedVolatilityPct: result.annualizedVolatilityPct,
                winRate: result.winRate,
                currentNetApy: result.currentNetApy,
                bootstrap: result.bootstrap,
                outOfSample: result.outOfSample,
            };
        });

        strategies.sort((a, b) => (b.error ? -Infinity : b.cagr) - (a.error ? -Infinity : a.cagr));
        return { rangeDays, leverage, gasImpactApy, strategies, generatedAt: new Date().toISOString() };
    }
}

function chainName(chainId) {
    return { 1: 'Ethereum', 8453: 'Base', 42161: 'Arbitrum' }[chainId] || String(chainId);
}
