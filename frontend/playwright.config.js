import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './e2e',
    timeout: 45000,
    fullyParallel: false,
    // One global agent + one shared backend DB: specs must not step on each
    // other's simulation state.
    workers: 1,
    retries: 0,
    reporter: [['list']],
    use: {
        baseURL: 'http://localhost:5173',
        trace: 'retain-on-failure',
    },
    projects: [
        // Keep the first project named 'chromium' so the existing desktop
        // baselines (chromium-win32) stay valid.
        { name: 'chromium', use: { browserName: 'chromium' } },
        // Mobile/tablet projects only run the viewport-sensitive visual spec —
        // the functional specs assume the desktop sidebar (visible Stop button)
        // and would fail purely because of layout, not logic.
        { name: 'mobile-chromium', use: { browserName: 'chromium', viewport: { width: 375, height: 812 } }, testMatch: /visual\.spec\.js/ },
        { name: 'tablet-chromium', use: { browserName: 'chromium', viewport: { width: 768, height: 1024 } }, testMatch: /visual\.spec\.js/ },
    ],
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
