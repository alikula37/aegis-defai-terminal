import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        // Every worker gets its own temp DB (see test-setup.js) so parallel
        // suites never contend on the real aegis.db.
        setupFiles: ['./test-setup.js'],
        // On-chain integration tests require a funded Sepolia account + RPC and
        // are run explicitly via `npm run test:integration` (see package.json).
        exclude: ['node_modules/**', 'dist/**', '__tests__/integration/**'],
    },
});
