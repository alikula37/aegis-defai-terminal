import { defineConfig } from 'vitest/config';

// Dedicated config for on-chain integration tests (real Sepolia network).
// Run with: npm run test:integration
// fileParallelism: false — the tests share one funded signer; serialising
// avoids nonce collisions between concurrent broadcasters.
export default defineConfig({
    test: {
        include: ['__tests__/integration/**/*.test.js'],
        testTimeout: 180000,
        hookTimeout: 60000,
        fileParallelism: false,
        maxWorkers: 1,
    },
});
