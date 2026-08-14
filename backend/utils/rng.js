// ---- Deterministic, seedable PRNG (mulberry32) ----
// Same seed -> same sequence. Used for reproducible simulations and backtests.

let currentSeed = Date.now() >>> 0;

function mulberry32(a) {
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

let rng = mulberry32(currentSeed);

/** Reset the shared PRNG with a fixed seed for reproducible runs. */
export function setRngSeed(seed) {
    currentSeed = Number(seed) >>> 0;
    rng = mulberry32(currentSeed);
    return currentSeed;
}

/** Create an independent seeded PRNG (e.g. per-backtest-run). */
export function createSeededRandom(seed) {
    return mulberry32(Number(seed) >>> 0);
}

/** Current shared seed. */
export function getRngSeed() {
    return currentSeed;
}

/** Random float in [0, 1) from the shared PRNG. */
export function random() {
    return rng();
}

/** Random float in [min, max). */
export function randomRange(min, max) {
    return min + rng() * (max - min);
}

/** Random integer in [min, max] inclusive. */
export function randomInt(min, max) {
    return Math.floor(randomRange(min, max + 1));
}
