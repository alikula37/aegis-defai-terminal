const PRICES_CACHE_TTL_MS = 30000; // 30 seconds
const YIELDS_CACHE_TTL_MS = 300000; // 5 minutes
const YIELDS_MAX_BYTES = 15 * 1024 * 1024; // 15MB limit
const HISTORICAL_CACHE_TTL_MS = 600000; // 10 minutes
const FUNDING_CACHE_TTL_MS = 900000; // 15 minutes
const MORPHO_CACHE_TTL_MS = 300000; // 5 minutes

let pricesCache = { data: null, fetchedAt: 0 };
let yieldsCache = { data: null, fetchedAt: 0 };
const historicalCache = new Map(); // poolId -> { data, fetchedAt }
const fundingCache = new Map(); // coin -> { data, fetchedAt }
const morphoCache = new Map(); // `${chainId}:${loanAsset}` -> { data, fetchedAt }

function isCacheValid(cache, ttl) {
    return !!(cache && cache.data && (Date.now() - cache.fetchedAt < ttl));
}

async function fetchWithTimeout(url, timeoutMs = 5000, maxBytes = 0, options = {}) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);

        if (maxBytes > 0) {
            const contentLength = response.headers.get('content-length');
            if (contentLength && parseInt(contentLength, 10) > maxBytes) {
                throw new Error(`Response too large: ${contentLength} bytes`);
            }
        }
        return response;
    } catch (error) {
        clearTimeout(id);
        throw error;
    }
}

function isValidPricesPayload(data) {
    return data && data.coins && data.coins['coingecko:ethereum'] && data.coins['coingecko:usd-coin'];
}

function isValidYieldsPayload(data) {
    return data && Array.isArray(data.data) && data.data.length > 0;
}

export class OracleService {
    /** Clear all in-memory caches (used by tests). */
    static clearCaches() {
        pricesCache = { data: null, fetchedAt: 0 };
        yieldsCache = { data: null, fetchedAt: 0 };
        historicalCache.clear();
        fundingCache.clear();
        morphoCache.clear();
    }

    static async fetchWithFreshCache(cacheRef, url, validate, cacheWriter, statusRef, { timeoutMs = 5000, maxBytes = 0 } = {}) {
        // cacheRef is a closure-getter because module-level caches are reassigned.
        const { data, isFresh } = cacheRef();
        if (isFresh) return { data, status: statusRef.status };
        try {
            const res = await fetchWithTimeout(url, timeoutMs, maxBytes);
            if (res.status === 429) statusRef.status = 'API LIMIT';
            if (!res.ok) throw new Error(`Oracle API Error: failed ${url}`);
            const raw = await res.json();
            if (!validate(raw)) throw new Error('Oracle API Error: invalid payload');
            cacheWriter(raw);
            return { data: raw, status: statusRef.status };
        } catch (e) {
            if (data) {
                statusRef.status = statusRef.status === 'API LIMIT' ? 'API LIMIT' : 'DEGRADED';
                return { data, status: statusRef.status };
            }
            throw e;
        }
    }

    static async fetchRawData() {
        const statusRef = { status: 'LIVE' };

        const prices = await this.fetchWithFreshCache(
            () => ({ data: pricesCache.data, isFresh: isCacheValid(pricesCache, PRICES_CACHE_TTL_MS) }),
            'https://coins.llama.fi/prices/current/coingecko:ethereum,coingecko:usd-coin',
            isValidPricesPayload,
            (raw) => { pricesCache = { data: raw, fetchedAt: Date.now() }; },
            statusRef,
        );

        const yields = await this.fetchWithFreshCache(
            () => ({ data: yieldsCache.data, isFresh: isCacheValid(yieldsCache, YIELDS_CACHE_TTL_MS) }),
            'https://yields.llama.fi/pools',
            isValidYieldsPayload,
            (raw) => { yieldsCache = { data: raw, fetchedAt: Date.now() }; },
            statusRef,
            { timeoutMs: 15000, maxBytes: YIELDS_MAX_BYTES },
        );

        return { pricesData: prices.data, yieldsData: yields.data, status: statusRef.status };
    }

    /**
     * Historical APY series for a DefiLlama pool.
     * @param {string} poolId DefiLlama pool id
     * @param {number} rangeDays number of days of history to return (0 = all)
     * @returns {Promise<Array<{timestamp: string, apy: number}>>} oldest -> newest
     */
    static async getHistoricalPoolApy(poolId, rangeDays = 0) {
        if (!poolId) return [];
        if (!isCacheValid(historicalCache.get(poolId), HISTORICAL_CACHE_TTL_MS)) {
            const res = await fetchWithTimeout(`https://yields.llama.fi/chart/${poolId}`, 15000);
            if (!res.ok) throw new Error("Oracle API Error: Failed to fetch historical APY.");
            const raw = await res.json();
            if (!raw || raw.status !== 'success' || !Array.isArray(raw.data)) {
                throw new Error("Oracle API Error: Invalid historical APY structure.");
            }
            historicalCache.set(poolId, { data: raw.data, fetchedAt: Date.now() });
        }

        let points = historicalCache.get(poolId).data;
        if (rangeDays > 0) {
            const cutoff = Date.now() - rangeDays * 86400000;
            points = points.filter(p => new Date(p.timestamp).getTime() >= cutoff);
        }
        return points.map(p => ({ timestamp: p.timestamp, apy: typeof p.apy === 'number' ? p.apy : 0 }));
    }

    /**
     * Hyperliquid per-hour funding rates for a coin.
     * @param {string} coin e.g. 'ETH'
     * @param {number} hours how many hours back to fetch (max ~400 to stay under the 500-point API cap)
     * @returns {Promise<Array<{time: number, fundingRate: number}>>} oldest -> newest
     */
    static async getFundingRates(coin = 'ETH', hours = 24) {
        if (!coin) return [];
        const windowHours = Math.min(Math.max(hours, 1), 400);
        if (!isCacheValid(fundingCache.get(coin), FUNDING_CACHE_TTL_MS)) {
            const now = Date.now();
            const res = await fetchWithTimeout('https://api.hyperliquid.xyz/info', 15000, 0, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    type: 'fundingHistory',
                    coin,
                    startTime: now - windowHours * 3600000,
                    endTime: now,
                })
            });
            if (!res.ok) throw new Error("Oracle API Error: Failed to fetch funding rates.");
            const raw = await res.json();
            if (!Array.isArray(raw)) throw new Error("Oracle API Error: Invalid funding data structure.");
            fundingCache.set(coin, { data: raw, fetchedAt: Date.now() });
        }

        const all = fundingCache.get(coin).data;
        if (hours <= 0) return all;
        const cutoff = Date.now() - hours * 3600000;
        return all
            .filter(p => p.time >= cutoff)
            .map(p => ({ time: p.time, fundingRate: parseFloat(p.fundingRate) }));
    }

    /**
     * Real Morpho Blue borrow/supply APY for the most liquid USDC market on a chain.
     * @param {number} chainId EVM chain id (8453 Base, 1 Ethereum, 42161 Arbitrum)
     * @param {string} loanAsset USDC token address on that chain
     * @returns {Promise<{borrowApy: number, supplyApy: number, marketId: string|null}>} APY as percent
     */
    static async getMorphoUsdcRates(chainId = 1, loanAsset = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48') {
        const key = `${chainId}:${loanAsset}`;
        if (!isCacheValid(morphoCache.get(key), MORPHO_CACHE_TTL_MS)) {
            const query = {
                query: `{
                    markets(first: 40, where: {
                        loanAssetAddress_in: ["${loanAsset}"],
                        chainId_in: [${chainId}]
                    }) {
                        items {
                            marketId
                            state { borrowApy supplyApy utilization borrowAssetsUsd }
                        }
                    }
                }`
            };
            const res = await fetchWithTimeout('https://blue-api.morpho.org/graphql', 15000, 0, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(query)
            });
            if (!res.ok) throw new Error("Oracle API Error: Failed to fetch Morpho markets.");
            const raw = await res.json();
            if (!raw?.data?.markets?.items) throw new Error("Oracle API Error: Invalid Morpho market data.");
            morphoCache.set(key, { data: raw.data.markets.items, fetchedAt: Date.now() });
        }

        const items = morphoCache.get(key).data;
        // Pick the most liquid real market, skipping dust/fully-borrowed artifacts
        const candidates = items
            .filter(m => m.state && m.state.utilization > 0.001 && m.state.utilization < 0.999)
            .sort((a, b) => (b.state?.borrowAssetsUsd || 0) - (a.state?.borrowAssetsUsd || 0));

        if (!candidates.length) return { borrowApy: 0, supplyApy: 0, marketId: null };
        const top = candidates[0];
        return {
            borrowApy: (top.state.borrowApy || 0) * 100,
            supplyApy: (top.state.supplyApy || 0) * 100,
            marketId: top.marketId,
        };
    }
}
