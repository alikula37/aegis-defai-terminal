import config from '../../aegis.config.js';
import { StrategyManager } from '../../strategies/StrategyManager.js';
import { getLatestPortfolio } from '../../db/database.js';

const LIQUIDATION_THRESHOLD = 0.94; // sUSDe liquidation threshold on Morpho

function computeElapsedMinutes(portfolio) {
    if (!portfolio.timestamp) return 0;
    const lastTime = new Date(portfolio.timestamp + 'Z').getTime();
    const now = Date.now();
    if (isNaN(lastTime) || now <= lastTime) return 0;
    // Floor to whole minutes: keeps yield accrual deterministic within
    // the same minute (needed for reproducible SIM runs) and avoids
    // sub-second drift between snapshot calls.
    return Math.floor((now - lastTime) / 60000);
}

function computeHealthFactor(tvl, leverage, susdePrice) {
    const collateralValue = tvl * leverage * susdePrice;
    const debtValue = tvl * (leverage - 1);
    if (debtValue <= 0) return 1.5;
    return (collateralValue * LIQUIDATION_THRESHOLD) / debtValue;
}

function computeRwaApy(ptSyrupUsdcApy, aaveV4BorrowApy) {
    const rwaSpread = ptSyrupUsdcApy - aaveV4BorrowApy;
    if (rwaSpread <= 0) return { rwaSpread, rwaLeverage: 1, rwaNetApy: ptSyrupUsdcApy };
    const rwaLeverage = 4;
    return {
        rwaSpread,
        rwaLeverage,
        rwaNetApy: (ptSyrupUsdcApy * rwaLeverage) - (aaveV4BorrowApy * (rwaLeverage - 1)),
    };
}



/**
 * Shared snapshot assembly used by every data source (LIVE, SIM).
 * Takes raw market inputs + the simulation state and produces the exact
 * snapshot shape consumed by the agent and frontend.
 *
 * @param {object} inputs {
 *   ethPrice, usdcPrice, susdePrice, susdeApy, pendlePtSusdeApy,
 *   morphoBorrowApy, aaveV4BorrowApy, arbitrumBorrowApy, baseBorrowApy,
 *   hyperliquidFundingApy, jitLiquidityApy, gasPrice, blockNumber, oracleStatus
 * }
 * @param {object} simulationState
 */
export async function buildSnapshot(inputs, simulationState = {}, simulationId = null) {
    const {
        ethPrice,
        usdcPrice,
        susdePrice = 1.0,
        susdeApy,
        pendlePtSusdeApy,
        morphoBorrowApy,
        aaveV4BorrowApy,
        arbitrumBorrowApy,
        baseBorrowApy,
        hyperliquidFundingApy = 0,
        jitLiquidityApy,
        gasPrice,
        blockNumber = null,
        oracleStatus = 'LIVE',
    } = inputs;

    const consts = config.marketData.documentedConstants;
    const ptSyrupUsdcApy = consts.ptSyrupUsdcApy;
    const morphoPointsApy = consts.morphoPointsApy;
    const enaPointsApy = consts.enaPointsApy;
    const borosFundingYield = Math.max(0, susdeApy * consts.borosFundingYieldShare);
    const corkHedgeCost = -consts.corkHedgeCost;
    const bridgeCostUsd = consts.bridgeCostUsd;

    // getLatestPortfolio(null) is now explicitly null (2a81ef5): no baseline
    // row yet. Treat it as an empty portfolio — 0 TVL, 0 impact — which is
    // exactly the "fresh DB" case the gas-cost guard below expects.
    const currentPortfolio = (await getLatestPortfolio(simulationId)) || { tvl: 0, timestamp: null };

    // Determine collateral APY based on current state
    const collateralApy = simulationState.currentCollateral === 'PT-sUSDe' ? pendlePtSusdeApy : susdeApy;

    // Use best available borrow rate based on CURRENT state
    let bestBorrowApy = morphoBorrowApy;
    if (simulationState.currentBorrowProtocol === 'Aave V4 E-Mode') {
        bestBorrowApy = aaveV4BorrowApy;
    }

    // ---- Cross-chain borrow rate arbitrage ----
    const bestCrossChainBorrowApy = Math.min(arbitrumBorrowApy, baseBorrowApy);
    const crossChainNetwork = arbitrumBorrowApy < baseBorrowApy ? 'Arbitrum (Aave V3)' : 'Base (Aave V3)';

    if (simulationState.currentBorrowChain !== 'Ethereum') {
        bestBorrowApy = bestCrossChainBorrowApy;
    }

    const baseSpread = collateralApy - bestBorrowApy;
    const morphoSpread = collateralApy - morphoBorrowApy;

    // Leverage from LTV (capped 1x..10x); unwind when the spread is negative
    let leverage = 1 / (1 - simulationState.currentLtv);
    leverage = Math.max(1, Math.min(10, leverage));
    if (baseSpread <= 0) leverage = 1;

    // ---- Cross-chain guardrail: Minimum Viable TVL ----
    const singleTxGasCostUsd = (gasPrice * 100000 * 1e-9) * ethPrice;
    const migrationGasCostUsd = singleTxGasCostUsd * 4 * 0.52;
    const totalMigrationCostUsd = migrationGasCostUsd + bridgeCostUsd;

    let crossChainSavings = 0;
    let isCrossChainArbitrageAvailable = false;
    let minViableTvl = 0;

    if (simulationState.currentBorrowChain === 'Ethereum') {
        crossChainSavings = bestBorrowApy - bestCrossChainBorrowApy;
        if (crossChainSavings > 0) {
            const expectedDurationYears = 1 / 52;
            minViableTvl = totalMigrationCostUsd / ((crossChainSavings / 100) * expectedDurationYears);
            isCrossChainArbitrageAvailable = crossChainSavings > 0.5 && currentPortfolio.tvl > minViableTvl;
        }
    }

    // Net realized APY after gas costs. Guard the denominator: an empty
    // portfolio (fresh DB, no baseline row) must yield 0 impact, never NaN.
    const annualGasCostUsd = (gasPrice * 100000 * 1e-9) * ethPrice * 365;
    const gasImpactApy = currentPortfolio.tvl > 0 ? (annualGasCostUsd / currentPortfolio.tvl) * 100 : 0;

    // Per-primitive APYs
    const loopApy = (collateralApy * leverage) - (bestBorrowApy * (leverage - 1)) - gasImpactApy;
    const basisApy = hyperliquidFundingApy - gasImpactApy;
    const jitApy = jitLiquidityApy - gasImpactApy;

    const alloc = simulationState.allocations;
    const netApy = (loopApy * alloc.loop) + (basisApy * alloc.basis) + (jitApy * alloc.jit);

    const ethenaNetApy = (susdeApy * 4) - (morphoBorrowApy * 3) - gasImpactApy;

    const { rwaNetApy } = computeRwaApy(ptSyrupUsdcApy, aaveV4BorrowApy);

    // Dynamic Health Factor
    const newHealthFactor = computeHealthFactor(currentPortfolio.tvl, leverage, susdePrice);

    const marketData = { netApy, bestBorrowApy, aaveV4BorrowApy, rwaNetApy, ethenaNetApy, morphoBorrowApy, morphoPoolApy: susdeApy };
    const pointsData = { morphoPointsApy, enaPointsApy, borosFundingYield };
    const strategies = StrategyManager.getStrategies(currentPortfolio, marketData, pointsData);

    const totalPointsApy = (morphoPointsApy * 0.75) + (enaPointsApy * 0.70) + corkHedgeCost;
    const effectiveApy = netApy + totalPointsApy * 0.5;

    const elapsedMinutes = computeElapsedMinutes(currentPortfolio);

    const yieldPerMinute = (effectiveApy / 100) * currentPortfolio.tvl / (365 * 24 * 60);
    const earnedYield = yieldPerMinute * elapsedMinutes;
    const newTvl = currentPortfolio.tvl + earnedYield;

    return {
        ethPrice,
        usdcPrice,
        susdePrice,
        susdeApy,
        pendlePtSusdeApy,
        morphoBorrowApy,
        aaveV4BorrowApy,
        bestBorrowApy,
        baseSpread,
        morphoSpread,
        leverage,
        netApy,
        gasPrice,
        blockNumber,
        hyperliquidFundingApy,
        jitLiquidityApy,
        crossChain: {
            arbitrumBorrowApy,
            baseBorrowApy,
            bestCrossChainBorrowApy,
            crossChainSavings,
            isCrossChainArbitrageAvailable,
            bridgeCostUsd,
            crossChainNetwork,
            minViableTvl,
        },
        points: { morphoPointsApy, enaPointsApy, borosFundingYield, corkHedgeCost, totalPointsApy },
        portfolio: {
            tvl: newTvl,
            netApy,
            healthFactor: Number(newHealthFactor.toFixed(2)),
            collateralApy,
            susdeApy: pendlePtSusdeApy,
            morphoBorrowApy,
            aaveV4BorrowApy,
            bestBorrowApy,
            baseSpread,
            leverage,
            currentLtv: simulationState.currentLtv,
            currentCollateral: simulationState.currentCollateral,
            allocations: simulationState.allocations,
            deployedCapital: currentPortfolio.tvl,
            activeAgents: strategies.filter(s => s.status === 'ACTIVE').length,
            activeChain: simulationState.currentBorrowChain,
            activeProtocol: simulationState.currentBorrowProtocol,
            strategies,
            points: { morphoPointsApy, enaPointsApy, borosFundingYield, corkHedgeCost, totalPointsApy },
            crossChain: {
                arbitrumBorrowApy,
                baseBorrowApy,
                bestCrossChainBorrowApy,
                crossChainSavings,
                isCrossChainArbitrageAvailable,
                bridgeCostUsd,
                crossChainNetwork,
                minViableTvl,
            },
        },
        oracleStatus,
    };
}
