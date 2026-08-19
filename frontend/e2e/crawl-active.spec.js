// Regression guard: with an ACTIVE simulation every route must render without
// the error boundary taking over. Catches ReferenceError/TypeError crashes
// that unit tests miss — e.g. removed context fields still referenced, or
// array-consumers receiving an error-object response.
import { test, expect } from '@playwright/test';

const BACKEND = 'http://localhost:3001';

test.describe('Aegis DeFAI Terminal — active-sim page crawl', () => {
    test.describe.configure({ timeout: 90000 });
    test.use({ baseURL: 'http://localhost:5173' });

    test('every route renders without a runtime error while the agent runs', async ({ page, request }) => {
        // Best-effort login so the suite also runs against auth-enabled
        // backends (test-mode backends have no auth — the request is ignored).
        await request.post(`${BACKEND}/api/auth/login`, {
            data: { username: 'local', password: 'AegisAdmin123' },
        }).catch(() => {});

        const settings = await request.post(`${BACKEND}/api/settings`, {
            data: {
                dataMode: 'SIM',
                dataScenario: 'stable',
                rpcUrl: 'https://e2e-sepolia.invalid',
                openRouterKey: 'sk-or-e2e-placeholder',
            },
        });
        expect(settings.ok()).toBeTruthy();

        await page.goto('/');
        const startNew = page.getByRole('button', { name: /Start New/i }).first();
        await expect(startNew).toBeVisible({ timeout: 15000 });
        await startNew.click();
        await page.locator('input[name="simulationName"]').fill(`crawl ${Date.now()}`);
        await page.getByRole('button', { name: /Launch Agent/i }).click();
        await expect(page.getByRole('button', { name: /Stop Simulation/i })).toBeVisible({ timeout: 20000 });
        await page.waitForTimeout(3000);

        const routes = ['/', '/analytics', '/yield-strategies', '/live-data', '/ai-agent-logs', '/settings'];
        for (const route of routes) {
            await page.goto(route);
            await expect(page.getByText('AEGIS DeFAI').first()).toBeVisible({ timeout: 15000 });
            await expect(page.locator('text=/Something went wrong/i')).toHaveCount(0);
        }

        // Cleanup via API — the UI stop button may be gone if another test in
        // the suite already stopped the (single global) agent.
        await request.post(`${BACKEND}/api/simulation/stop`);
    });
});
