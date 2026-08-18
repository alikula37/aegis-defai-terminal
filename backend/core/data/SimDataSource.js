import config from '../../aegis.config.js';
import { createSeededRandom, getRngSeed } from '../../utils/rng.js';
import { buildSnapshot } from './buildSnapshot.js';

/**
 * Scenario scenarios (documented stochastic models) used when no real market
 * data is available or for stress-testing.
 *
 * Unlike the previous uniform-draw model, the base APY, borrow rate and
 * sUSDe peg are now proper stochastic processes:
 *   - APY / borrow : mean-reverting Ornstein-Uhlenbeck process (theta pulls
 *                    the value back toward `mu` with noise `sigma`).
 *   - ETH price    : geometric Brownian motion (drift + multiplicative noise).
 *   - sUSDe peg    : mean-reverting OU around 1.0 — the depeg scenario adds a
 *                    persistent negative drift that grinds toward liquidation.
 *   - cross-series : a shared shock with per-scenario correlation `rho`
 *                    (bull: borrow negatively correlates with supply so the
 *                    spread widens; bear: positive rho compresses it).
 *
 * The path is a pure function of (seed, scenario, step): a fixed simulation
 * seed reproduces the exact run, and each cycle advances the process instead
 * of re-sampling independent uniforms.
 */
const SCENARIOS = {
    stable: {
        label: 'Stable (baseline)',
        susde: { start: 4.5, mu: 4.5, sigma: 0.25, theta: 0.8 },
        pendlePremium: [0.3, 0.7],
        borrow: { start: 4.5, mu: 4.5, sigma: 0.25, theta: 0.8 },
        rho: 0.1,
        arbSpread: [-0.6, 0.2],
        baseSpreadDelta: [0.1, 0.4],
        fundingApy: [8, 14],
        eth: { start: 2000, mu: 0.0004, sigma: 0.02 },
        gasPrice: [12, 18],
        susdePeg: { start: 1.0, mu: 1.0, sigma: 0.0005, theta: 0.1 },
    },
    bull: {
        label: 'Bull (positive spread)',
        susde: { start: 5.2, mu: 5.6, sigma: 0.4, theta: 0.6 },
        pendlePremium: [1.2, 2.0],
        borrow: { start: 3.8, mu: 3.6, sigma: 0.3, theta: 0.7 },
        rho: -0.3,
        arbSpread: [-0.8, -0.2],
        baseSpreadDelta: [0.2, 0.6],
        fundingApy: [15, 25],
        eth: { start: 2500, mu: 0.001, sigma: 0.025 },
        gasPrice: [10, 15],
        susdePeg: { start: 1.0, mu: 1.0, sigma: 0.0004, theta: 0.1 },
    },
    bear: {
        label: 'Bear (negative spread)',
        susde: { start: 3.9, mu: 3.6, sigma: 0.3, theta: 0.7 },
        pendlePremium: [0.0, 0.2],
        borrow: { start: 6.2, mu: 6.8, sigma: 0.3, theta: 0.7 },
        rho: 0.5,
        arbSpread: [-0.3, 0.3],
        baseSpreadDelta: [0.3, 0.7],
        fundingApy: [2, 6],
        eth: { start: 1400, mu: -0.001, sigma: 0.03 },
        gasPrice: [20, 40],
        susdePeg: { start: 0.99, mu: 0.99, sigma: 0.0008, theta: 0.1 },
    },
    depeg: {
        label: 'sUSDe depeg (liquidation stress)',
        susde: { start: 4.7, mu: 4.8, sigma: 0.3, theta: 0.8 },
        pendlePremium: [0.8, 1.2],
        borrow: { start: 4.2, mu: 4.2, sigma: 0.25, theta: 0.8 },
        rho: 0.2,
        arbSpread: [-0.5, 0.2],
        baseSpreadDelta: [0.2, 0.5],
        fundingApy: [8, 14],
        eth: { start: 2000, mu: 0.0, sigma: 0.02 },
        gasPrice: [15, 25],
        // Slow persistent drift toward the 0.96 liquidation level — theta is
        // small so the depeg is a grinding slide, not an instant snap.
        susdePeg: { start: 0.995, mu: 0.955, sigma: 0.0008, theta: 0.06 },
    },
};

// Per-simulation cycle counter, so the process advances on every snapshot
// while staying a pure function of (seed, scenario, step). Bounded to avoid
// unbounded growth across many simulations.
const STEP_MAP = new Map();
const MAX_TRACKED = 100;

/** Reset the path for a simulation (used by tests to re-seed a scenario). */
export function resetSimulationPath(simulationId) {
    if (simulationId !== undefined && simulationId !== null) STEP_MAP.delete(String(simulationId));
}

function nextStep(simulationId) {
    const key = String(simulationId ?? 'default');
    const step = (STEP_MAP.get(key) ?? 0) + 1;
    STEP_MAP.set(key, step);
    if (STEP_MAP.size > MAX_TRACKED) {
        const oldest = STEP_MAP.keys().next().value;
        STEP_MAP.delete(oldest);
    }
    return step;
}

function gaussian(rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2.0 * Math.log(u)) * Math.cos(2.0 * Math.PI * v);
}

/** One step of a mean-reverting Ornstein-Uhlenbeck process. */
function ouStep(prev, { mu, sigma, theta }, rand) {
    return prev + theta * (mu - prev) + sigma * rand();
}

/** One step of geometric Brownian motion. */
function gbmStep(prev, { mu, sigma }, rand) {
    return prev * Math.exp(mu - 0.5 * sigma * sigma + sigma * rand());
}

function clamp(v, lo, hi) {
    return Math.max(lo, Math.min(hi, v));
}

/**
 * Seeded scenario data source. Produces the same snapshot shape as the LIVE
 * source but from a deterministic stochastic scenario model — used for
 * stress-testing the agent's decisions without relying on real market data.
 */
export class SimDataSource {
    static async getSnapshot(simulationState = {}, opts = {}) {
        const scenarioName = SCENARIOS[opts.scenario] ? opts.scenario : 'stable';
        const s = SCENARIOS[scenarioName];

        // Seed the path's RNG from (seed, scenario, step) — the same seed and
        // step always reproduce the same path, and the step advances per cycle.
        const seed = Number(opts.seed ?? getRngSeed()) >>> 0;
        const step = nextStep(opts.simulationId);
        const pathRng = createSeededRandom((seed + (step * 7919) + (scenarioName.length * 104729)) >>> 0);
        const pathRandom = pathRng;

        // Local gaussian bound to this path's rng for determinism.
        const pathGauss = () => gaussian(pathRandom);

        // ---- Stochastic core: OU processes + GBM price + correlated borrow ----
        const susdeApy = clamp(ouStep(s.susde.start, s.susde, pathGauss), 1.0, 25);
        const susdeShock = pathGauss();
        // Borrow = mean-reverting OU plus a correlated component: when rho<0 a
        // positive supply shock drags borrow down (bull spread widens), and
        // vice-versa.
        const borrowNoise = s.rho * susdeShock + Math.sqrt(1 - s.rho * s.rho) * pathGauss();
        const morphoBorrowApy = clamp(ouStep(s.borrow.start, s.borrow, () => borrowNoise), 1.0, 25);

        const pendlePtSusdeApy = susdeApy + s.pendlePremium[0] + pathRandom() * (s.pendlePremium[1] - s.pendlePremium[0]);
        const aaveV4BorrowApy = morphoBorrowApy; // consistent with LIVE until Phase 2
        const arbitrumBorrowApy = Math.max(1.5, morphoBorrowApy + s.arbSpread[0] + pathRandom() * (s.arbSpread[1] - s.arbSpread[0]));
        const baseBorrowApy = Math.max(1.5, morphoBorrowApy + s.baseSpreadDelta[0] + pathRandom() * (s.baseSpreadDelta[1] - s.baseSpreadDelta[0]));
        const hyperliquidFundingApy = s.fundingApy[0] + pathRandom() * (s.fundingApy[1] - s.fundingApy[0]);

        // ETH: geometric Brownian motion.
        const ethPrice = gbmStep(s.eth.start, s.eth, pathGauss);

        // sUSDe soft peg: OU around target; depeg scenario drifts downward.
        const susdePrice = clamp(ouStep(s.susdePeg.start, s.susdePeg, pathGauss), 0.95, 1.02);

        const jitLiquidityApy = config.marketData.documentedConstants.jitLiquidityApy;
        const gasPrice = s.gasPrice[0] + pathRandom() * (s.gasPrice[1] - s.gasPrice[0]);

        return buildSnapshot({
            ethPrice,
            usdcPrice: 1.0,
            susdePrice,
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