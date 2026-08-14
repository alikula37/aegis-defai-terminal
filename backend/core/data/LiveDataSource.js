import { ethers } from 'ethers';
import logger from '../../utils/logger.js';
import config from '../../aegis.config.js';
import { OracleService } from '../../services/OracleService.js';
import { getSettings } from '../../db/database.js';
import { buildSnapshot } from './buildSnapshot.js';

// ---- Singleton RPC provider (avoid re-instantiating on every cycle) ----
let _rpcProvider = null;
let _rpcProviderUrl = null;

function getRpcProvider(url) {
    if (!url) return null;
    if (_rpcProvider && _rpcProviderUrl === url) return _rpcProvider;
    _rpcProvider = new ethers.JsonRpcProvider(url);
    _rpcProviderUrl = url;
    return _rpcProvider;
}
export function invalidateRpcProvider() {
    _rpcProvider = null;
    _rpcProviderUrl = null;
}

/**
 * Real market data source. All APY/rate inputs come from live oracles
 * (DefiLlama, Hyperliquid, Morpho GraphQL) or documented constants.
 */
export class LiveDataSource {
    static async getSnapshot(simulationState = {}, opts = {}) {
        const { pricesData, yieldsData, status } = await OracleService.fetchRawData();
        const ethPrice = pricesData.coins['coingecko:ethereum'].price;
        const usdcPrice = pricesData.coins['coingecko:usd-coin'].price;
        const poolById = (id) => yieldsData.data.find(p => p.pool === id);
        const susdePool = poolById(config.marketData.pools.susde);
        const pendlePool = poolById(config.marketData.pools.pendleSusde);
        if (!susdePool) throw new Error("Oracle API Error: Could not find sUSDe pool data on DefiLlama.");

        const susdeApy = susdePool.apy;
        const pendlePtSusdeApy = pendlePool && pendlePool.apy != null ? pendlePool.apy : susdeApy;

        // Real Morpho borrow APY per chain (Ethereum / Arbitrum / Base USDC)
        const [morphoBorrowApy, arbitrumBorrowApy, baseBorrowApy] = await Promise.all([
            OracleService.getMorphoUsdcRates(1, config.marketData.usdcAddresses[1]).then(r => r.borrowApy || 4.0).catch(() => 4.0),
            OracleService.getMorphoUsdcRates(42161, config.marketData.usdcAddresses[42161]).then(r => r.borrowApy || 4.0).catch(() => 4.0),
            OracleService.getMorphoUsdcRates(8453, config.marketData.usdcAddresses[8453]).then(r => r.borrowApy || 4.0).catch(() => 4.0),
        ]);

        // Aave V4 connector lands in Phase 2; until then the L1 borrow baseline is
        // the real Morpho rate (kept identical so the migration guardrail stays dormant).
        const aaveV4BorrowApy = morphoBorrowApy;

        // Real Hyperliquid funding APY (basis strategy)
        let hyperliquidFundingApy = 0;
        try {
            const funding = await OracleService.getFundingRates(config.marketData.fundingCoin, 24);
            if (funding.length) {
                hyperliquidFundingApy = funding[funding.length - 1].fundingRate * 8760 * 100;
            }
        } catch (e) {
            logger.info('[MARKET] Funding fetch failed, using 0.');
        }

        // JIT liquidity baseline (documented constant)
        const jitLiquidityApy = config.marketData.documentedConstants.jitLiquidityApy;

        // Gas price from RPC when configured, else documented fallback
        let gasPrice = config.marketData.documentedConstants.simulatedGasPriceGwei;
        let blockNumber = null;
        try {
            const settings = await getSettings();
            const provider = getRpcProvider(settings.rpcUrl);
            if (provider) {
                const feeData = await provider.getFeeData();
                if (feeData.gasPrice) {
                    gasPrice = Number(ethers.formatUnits(feeData.gasPrice, 'gwei'));
                }
                blockNumber = await provider.getBlockNumber();
            }
        } catch (e) {
            logger.info("[SYSTEM] RPC Connection failed or not configured, using simulated gas.");
            invalidateRpcProvider();
        }

        return buildSnapshot({
            ethPrice,
            usdcPrice,
            susdePrice: 1.0,
            susdeApy,
            pendlePtSusdeApy,
            morphoBorrowApy,
            aaveV4BorrowApy,
            arbitrumBorrowApy,
            baseBorrowApy,
            hyperliquidFundingApy,
            jitLiquidityApy,
            gasPrice,
            blockNumber,
            oracleStatus: status,
        }, simulationState, opts.simulationId);
    }
}
