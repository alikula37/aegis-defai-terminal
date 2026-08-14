// End-to-end flow: start simulation → receive live updates → stop.
// Requires backend (port 3001) + frontend dev server (port 5173), both started
// automatically by playwright.config.js.
import { test, expect } from '@playwright/test';

const BACKEND = 'http://localhost:3001';

test.describe('Aegis DeFAI Terminal', () => {
    test.use({ baseURL: 'http://localhost:5173' });

    test('starts a simulation, streams live data, then stops', async ({ page, request }) => {
        // Seed SIM mode + dummy RPC/key so the start modal needs no configuration
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

        // Idle state: the Overview prompts to start the agent
        const startNew = page.getByRole('button', { name: /Start New/i }).first();
        await expect(startNew).toBeVisible({ timeout: 15000 });
        await startNew.click();

        // Modal opens — use a unique name so repeated runs never collide
        const name = `E2E ${Date.now()}`;
        await page.locator('input[name="simulationName"]').fill(name);
        await page.getByRole('button', { name: /Launch Agent/i }).click();

        // Simulation running: Stop control becomes available in the sidebar
        const stopButton = page.getByRole('button', { name: /Stop Simulation/i });
        await expect(stopButton).toBeVisible({ timeout: 20000 });

        // Live update: a USD portfolio figure appears on the dashboard
        await expect(page.locator('text=/\\$\\d{1,3}(,\\d{3})*\\.\\d{2}/').first()).toBeVisible({ timeout: 30000 });

        // Faz 3 (B3-4/B3-5): the agent terminal shows auditable decisions —
        // a 🧠 decision line (hold/claim/...) plus its structured reasoning.
        await expect(page.locator('text=/🧠/').first()).toBeVisible({ timeout: 30000 });
        await expect(page.locator('text=/situation:/').first()).toBeVisible({ timeout: 15000 });

        // Stop the simulation and return to the idle state
        await stopButton.click();
        await expect(page.getByRole('button', { name: /Start New/i }).first()).toBeVisible({ timeout: 20000 });
    });
});
