import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 45000,
    fullyParallel: false,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
    webServer: [
        {
            command: 'node server.js',
            cwd: '../backend',
            port: 3001,
            reuseExistingServer: true,
            timeout: 20000,
        },
        {
            command: 'npm run dev',
            cwd: '.',
            port: 5173,
            reuseExistingServer: true,
            timeout: 30000,
        },
    ],
});
