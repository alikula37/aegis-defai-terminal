import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // On-chain integration tests require a funded Sepolia account + RPC and
        // are run explicitly via `npm run test:integration` (see package.json).
        exclude: ['node_modules/**', 'dist/**', '__tests__/integration/**'],
    },
});
