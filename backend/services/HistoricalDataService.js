import { recordMarketHistory, getMarketHistory, getLatestMarketHistory } from '../db/database.js';
import { OracleService } from './OracleService.js';
import config from '../aegis.config.js';

// Keys used in the market_history table (source column)
export const HISTORY_SOURCES = {
    SNAPSHOT: 'cycle_snapshot',
    POOL_APY: 'pool_apy',
    FUNDING: 'funding',
    MORPHO_BORROW: 'morpho_borrow',
    MORPHO_SUPPLY: 'morpho_supply',
};

const REFRESH_TTL_MS = 12 * 3600000; // 12h before a stored series is refetched

let lastSnapshotAt = 0;
const SNAPSHOT_THROTTLE_MS = 60000; // record at most one snapshot per minute

/**
 * Aggregates real market data across time for backtesting and trend analysis.
 * Persists snapshots/series in the market_history table so history survives restarts.
 */
export class HistoricalDataService {
    /** Persist a compact snapshot of the current real market state (throttled to 1/min). */
    static recordSnapshot(marketData) {
        if (!marketData) return;
        const now = Date.now();
        if (now - lastSnapshotAt < SNAPSHOT_THROTTLE_MS) return;
        lastSnapshotAt = now;
        try {
            recordMarketHistory(HISTORY_SOURCES.SNAPSHOT, 'all', {
                ts: new Date().toISOString(),
                susdeApy: marketData.susdeApy ?? null,
                pendlePtSusdeApy: marketData.pendlePtSusdeApy ?? null,
                morphoBorrowApy: marketData.morphoBorrowApy ?? null,
                aaveV4BorrowApy: marketData.aaveV4BorrowApy ?? null,
                hyperliquidFundingApy: marketData.hyperliquidFundingApy ?? null,
                netApy: marketData.netApy ?? null,
                tvl: marketData.portfolio?.tvl ?? null,
                ethPrice: marketData.ethPrice ?? null,
            });
        } catch (e) {
            // Recording history must never break the agent cycle
            console.error('[HISTORY] Failed to record snapshot:', e.message);
        }
    }

    /**
     * Real historical APY for a DefiLlama pool (persisted + refreshed).
     * @param {string} poolId
     * @param {string} symbol label for the DB key
     * @param {number} rangeDays days of history to return
     * @returns {Promise<Array<{timestamp: string, apy: number}>>} oldest -> newest
     */
    static async getPoolApyHistory(poolId, symbol, rangeDays = 90) {
        // Try to reuse a fresh stored series first
        const stored = await getLatestMarketHistory(HISTORY_SOURCES.POOL_APY, symbol);
        const storedTs = stored?.timestamp ? new Date(stored.timestamp).getTime() : null;
        const stale = !stored || !storedTs || (Date.now() - storedTs) > REFRESH_TTL_MS;

        if (stale) {
            const points = await OracleService.getHistoricalPoolApy(poolId, 0);
            // Replace stored series with the freshly fetched one
            recordMarketHistory(HISTORY_SOURCES.POOL_APY, symbol, points);
            return filterByRange(points, rangeDays);
        }

        const rows = await getMarketHistory(HISTORY_SOURCES.POOL_APY, symbol, 1);
        if (!rows.length) return [];
        const points = JSON.parse(rows[0].payload_json);
        return filterByRange(points, rangeDays);
    }

    /**
     * Real historical Hyperliquid funding rates for a coin.
     * @param {string} coin e.g. 'ETH'
     * @param {number} days days of history to return
     * @returns {Promise<Array<{time: number, fundingRate: number}>>} oldest -> newest
     */
    static async getFundingHistory(coin = 'ETH', days = 7) {
        const totalHours = Math.max(days, 1) * 24;
        const chunkHours = 400; // stay under Hyperliquid's 500-point/query cap (hourly points)
        const out = [];
        let end = Date.now();
        let guard = 0;

        while (guard < 20) {
            const start = end - chunkHours * 3600000;
            const chunk = await fetchFundingWindow(coin, start, end);
            out.push(...chunk);
            if (chunk.length < chunkHours) break; // reached the beginning of available history
            end = start;
            guard++;
            if (end < Date.now() - totalHours * 3600000) break;
        }

        const seen = new Set();
        const unique = [];
        for (const p of out) {
            if (!seen.has(p.time)) {
                seen.add(p.time);
                unique.push(p);
            }
        }
        unique.sort((a, b) => a.time - b.time);
        const cutoff = Date.now() - days * 86400000;
        return unique.filter(p => p.time >= cutoff);
    }

    /**
     * Real historical Morpho USDC borrow APY for a chain.
     * @param {number} chainId
     * @param {string} loanAsset USDC address
     * @param {string} symbol label for the DB key
     * @param {number} rangeDays days of history to return
     * @returns {Promise<Array<{time: number, borrowApy: number}>>} oldest -> newest
     */
    static async getBorrowRateHistory(chainId, loanAsset, symbol, rangeDays = 90) {
        return this.getMorphoRateHistory(chainId, loanAsset, symbol, 'borrowApy', rangeDays);
    }

    /**
     * Real historical Morpho USDC supply APY for a chain (used by the strategy
     * comparison backtests).
     * @returns {Promise<Array<{time: number, supplyApy: number}>>} oldest -> newest
     */
    static async getSupplyRateHistory(chainId, loanAsset, symbol, rangeDays = 90) {
        return this.getMorphoRateHistory(chainId, loanAsset, symbol, 'supplyApy', rangeDays);
    }

    /**
     * Real historical Morpho APY for either the borrow or supply side.
     * @param {number} chainId
     * @param {string} loanAsset USDC address
     * @param {string} symbol label for the DB key
     * @param {'borrowApy'|'supplyApy'} field which rate to pull
     * @param {number} rangeDays days of history to return
     * @returns {Promise<Array<{time: number, [field]: number}>>} oldest -> newest
     */
    static async getMorphoRateHistory(chainId, loanAsset, symbol, field = 'borrowApy', rangeDays = 90) {
        const source = field === 'supplyApy' ? HISTORY_SOURCES.MORPHO_SUPPLY : HISTORY_SOURCES.MORPHO_BORROW;
        const stored = await getLatestMarketHistory(source, symbol);
        const stale = !stored || (Date.now() - new Date(stored.timestamp).getTime()) > REFRESH_TTL_MS;

        if (stale) {
            const points = await fetchMorphoRateHistory(chainId, loanAsset, field);
            recordMarketHistory(source, symbol, points);
            return filterBorrowByRange(points, rangeDays);
        }

        const rows = await getMarketHistory(source, symbol, 1);
        if (!rows.length) return [];
        const points = JSON.parse(rows[0].payload_json);
        return filterBorrowByRange(points, rangeDays);
    }

    /**
     * Assemble an aligned time series for the delta-neutral loop strategy backtest.
     * Aligns real historical sUSDe APY, Morpho borrow APY and (optional) funding APY
     * onto a common daily grid.
     * @param {number} rangeDays
     * @returns {Promise<Array<{date: string, susdeApy: number, borrowApy: number, fundingApy: number}>>}
     */
    static async buildBacktestDataset(rangeDays = 90) {
        const susdePoolId = config.marketData.pools.susde;
        const ethUsdc = config.marketData.usdcAddresses[1];

        const [susdeSeries, borrowSeries, fundingSeries] = await Promise.all([
            this.getPoolApyHistory(susdePoolId, 'susde', rangeDays),
            this.getBorrowRateHistory(1, ethUsdc, 'eth-usdc', rangeDays),
            this.getFundingHistory(config.marketData.fundingCoin, Math.min(rangeDays, 7)).catch(() => []),
        ]);

        const days = buildDayGrid(rangeDays);
        const susdeMap = indexByDay(susdeSeries, p => p.apy);
        const borrowMap = indexByDay(borrowSeries, p => p.borrowApy);

        // Current funding as a single value fallback when history is unavailable
        let currentFundingApy = 0;
        if (fundingSeries.length) {
            currentFundingApy = fundingSeries[fundingSeries.length - 1].fundingRate * 8760 * 100;
        }

        // Forward-fill rates so the daily grid has no gaps (rates move slowly)
        let lastSusde = null;
        let lastBorrow = null;
        return days.map(d => {
            const k = key(d);
            if (susdeMap.has(k)) lastSusde = susdeMap.get(k);
            if (borrowMap.has(k)) lastBorrow = borrowMap.get(k);
            return {
                date: d.toISOString().slice(0, 10),
                susdeApy: lastSusde,
                borrowApy: lastBorrow,
                fundingApy: fundingSeries.length ? currentFundingApy : 0,
            };
        });
    }
}

// ---- internal helpers ----
function filterByRange(points, rangeDays) {
    if (rangeDays <= 0) return points;
    const cutoff = Date.now() - rangeDays * 86400000;
    return points.filter(p => new Date(p.timestamp).getTime() >= cutoff);
}

function filterBorrowByRange(points, rangeDays) {
    if (rangeDays <= 0) return points;
    const cutoff = Date.now() - rangeDays * 86400000;
    return points.filter(p => p.time >= cutoff / 1000 || p.time * 1000 >= cutoff);
}

function buildDayGrid(rangeDays) {
    const days = [];
    const now = new Date();
    for (let i = rangeDays - 1; i >= 0; i--) {
        const d = new Date(now);
        d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() - i);
        days.push(d);
    }
    return days;
}

function key(date) {
    return date.toISOString().slice(0, 10);
}

function indexByDay(points, valueFn) {
    const map = new Map();
    for (const p of points) {
        const ts = p.timestamp || (p.time ? new Date(p.time * 1000).toISOString() : null);
        if (!ts) continue;
        const k = ts.slice(0, 10);
        const v = valueFn(p);
        if (v != null) map.set(k, v);
    }
    return map;
}

async function fetchFundingWindow(coin, startTime, endTime) {
    const res = await fetchWithTimeout('https://api.hyperliquid.xyz/info', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'fundingHistory', coin, startTime, endTime })
    }, 15000);
    if (!res.ok) throw new Error('Failed to fetch funding history.');
    const raw = await res.json();
    if (!Array.isArray(raw)) throw new Error('Invalid funding history structure.');
    return raw.map(p => ({ time: p.time, fundingRate: parseFloat(p.fundingRate) }));
}
async function fetchMorphoRateHistory(chainId, loanAsset, field = 'borrowApy') {
    const query = {
        query: `{
            markets(first: 40, where: {
                loanAssetAddress_in: ["${loanAsset}"],
                chainId_in: [${chainId}]
            }) {
                items {
                    marketId
                    state { borrowAssetsUsd utilization }
                    historicalState { ${field} { x y } }
                }
            }
        }`
    };
    const res = await fetchWithTimeout('https://blue-api.morpho.org/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query)
    }, 15000);
    if (!res.ok) throw new Error('Failed to fetch Morpho borrow history.');
    const raw = await res.json();
    const items = raw?.data?.markets?.items || [];
    // Skip dust / fully-borrowed markets whose utilization distorts APY to absurd levels
    const top = items
        .filter(m => m.state
            && m.state.borrowAssetsUsd > 10000
            && m.state.utilization > 0.05
            && m.state.utilization < 0.95)
        .sort((a, b) => b.state.borrowAssetsUsd - a.state.borrowAssetsUsd)[0];

    if (!top?.historicalState?.[field]) return [];
    return top.historicalState[field]
        .map(p => ({ time: p.x, [field]: (p.y || 0) * 100 }))
        .filter(p => p[field] > 0 && p[field] < 50) // clamp to a sane APY range
        .sort((a, b) => a.time - b.time);
}

// fetch with an AbortController timeout so a hung upstream API can never hang
// the backtest / the run_backtest tool indefinitely.
async function fetchWithTimeout(url, options = {}, timeoutMs = 15000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timer);
    }
}
