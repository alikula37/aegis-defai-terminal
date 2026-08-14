import config from '../../aegis.config.js';
import { randomRange } from '../../utils/rng.js';
import { buildSnapshot } from './buildSnapshot.js';

/**
 * Scenario scenarios (documented deterministic models) used when no real
 * market data is available or for stress-testing. Uses the shared seeded
 * PRNG so a fixed simulation seed reproduces the run exactly.
 */
const SCENARIOS = {
    stable: {
        label: 'Stable (baseline)',
        susdeApy: [4.2, 4.8],
        pendlePremium: [0.3, 0.7],
        borrowApy: [4.2, 4.8],
        arbSpread: [-0.6, 0.2],   // Arbitrum borrow delta vs Ethereum
        baseSpreadDelta: [0.1, 0.4], // Base borrow delta vs Ethereum
        fundingApy: [8, 14],
        ethPrice: [1800, 2200],
        gasPrice: [12, 18],
        susdePrice: 1.0,
    },
    bull: {
        label: 'Bull (positive spread)',
        susdeApy: [4.5, 5.5],
        pendlePremium: [1.2, 2.0],
        borrowApy: [3.5, 4.2],
        arbSpread: [-0.8, -0.2],
        baseSpreadDelta: [0.2, 0.6],
        fundingApy: [15, 25],
        ethPrice: [2200, 2800],
        gasPrice: [10, 15],
        susdePrice: 1.0,
    },
    bear: {
        label: 'Bear (negative spread)',
        susdeApy: [3.5, 4.2],
        pendlePremium: [0.0, 0.2],
        borrowApy: [5.5, 7.0],
        arbSpread: [-0.3, 0.3],
        baseSpreadDelta: [0.3, 0.7],
        fundingApy: [2, 6],
        ethPrice: [1200, 1600],
        gasPrice: [20, 40],
        susdePrice: 1.0,
    },
    depeg: {
        label: 'sUSDe depeg (liquidation stress)',
        susdeApy: [4.5, 5.0],
        pendlePremium: [0.8, 1.2],   // keep spread positive so leverage stays engaged
        borrowApy: [4.0, 4.5],
        arbSpread: [-0.5, 0.2],
        baseSpreadDelta: [0.2, 0.5],
        fundingApy: [8, 14],
        ethPrice: [1800, 2200],
        gasPrice: [15, 25],
        susdePrice: 0.965, // sUSDe depegs below the 10x liquidation price (~0.96)
    },
};

/**
 * Seeded scenario data source. Produces the same snapshot shape as the LIVE
 * source but from a deterministic scenario model — used for stress-testing
 * the agent's decisions without relying on real market data.
 */
export class SimDataSource {
    /**
     * @param {object} simulationState
     * @param {object} [opts] { scenario = 'stable' }
     */
    static async getSnapshot(simulationState = {}, opts = {}) {
        const scenarioName = SCENARIOS[opts.scenario] ? opts.scenario : 'stable';
        const s = SCENARIOS[scenarioName];

        const susdeApy = randomRange(s.susdeApy[0], s.susdeApy[1]);
        const pendlePtSusdeApy = susdeApy + randomRange(s.pendlePremium[0], s.pendlePremium[1]);
        const morphoBorrowApy = randomRange(s.borrowApy[0], s.borrowApy[1]);
        const aaveV4BorrowApy = morphoBorrowApy; // consistent with LIVE until Phase 2
        const arbitrumBorrowApy = Math.max(1.5, morphoBorrowApy + randomRange(s.arbSpread[0], s.arbSpread[1]));
        const baseBorrowApy = Math.max(1.5, morphoBorrowApy + randomRange(s.baseSpreadDelta[0], s.baseSpreadDelta[1]));
        const hyperliquidFundingApy = randomRange(s.fundingApy[0], s.fundingApy[1]);
        const jitLiquidityApy = config.marketData.documentedConstants.jitLiquidityApy;
        const ethPrice = randomRange(s.ethPrice[0], s.ethPrice[1]);
        const gasPrice = randomRange(s.gasPrice[0], s.gasPrice[1]);

        return buildSnapshot({
            ethPrice,
            usdcPrice: 1.0,
            susdePrice: s.susdePrice,
            susdeApy,
            pendlePtSusdeApy,
            morphoBorrowApy,
            aaveV4BorrowApy,
            arbitrumBorrowApy,
            baseBorrowApy,
            hyperliquidFundingApy,
            jitLiquidityApy,
            gasPrice,
            blockNumber: null,
            oracleStatus: `SIM (${scenarioName})`,
        }, simulationState, opts.simulationId);
    }
}
