// End-to-end flow: start simulation → receive live updates → stop.
// Requires backend (port 3001) + frontend dev server (port 5173), both started
// automatically by playwright.config.js.
import { test, expect } from '@playwright/test';

const BACKEND = 'http://localhost:3001';

test.describe('Aegis DeFAI Terminal', () => {
    test.use({ baseURL: 'http://localhost:5173' });

    test('starts a simulation, streams live data, then stops', async ({ page, request }) => {
        // Sign in when the backend runs in auth mode (test-mode backends have
        // no auth; the login request then fails and is ignored). The request
        // fixture shares cookies with the page context.
        await request.post(`${BACKEND}/api/auth/login`, {
            data: { username: 'local', password: 'AegisAdmin123' },
        }).catch(() => {});

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

        // The dashboard actually renders its charts (recharts SVG surfaces)
        // once the first portfolio snapshot lands in the DB.
        await expect(page.locator('.recharts-surface').first()).toBeVisible({ timeout: 30000 });

        // Stop the simulation and return to the idle state
        await stopButton.click();
        await expect(page.getByRole('button', { name: /Start New/i }).first()).toBeVisible({ timeout: 20000 });
    });

    test('every route renders without a runtime error', async ({ page }) => {
        // Regression guard: catches ReferenceError/undefined-var crashes that
        // unit tests miss (e.g. a removed context field still used in a page).
        const routes = ['/', '/yield-strategies', '/live-data', '/ai-agent-logs', '/settings'];
        for (const route of routes) {
            await page.goto(route);
            // The app shell mounts (logo in the sidebar)
            await expect(page.getByText('AEGIS DeFAI').first()).toBeVisible({ timeout: 15000 });
            // …and the error boundary never takes over
            await expect(page.locator('text=/Something went wrong/i')).toHaveCount(0);
        }
    });

    test('start-screen risk choices sync to Settings Automation Parameters', async ({ page, request }) => {
        // Regression guard for the start-screen ↔ Settings/Overview coupling:
        // choosing a risk appetite in the new-simulation modal must propagate to
        // the SettingsContext (and thus the Settings page's Automation Parameters
        // and Overview's Health Factor target), not just the backend row.
        await request.post(`${BACKEND}/api/auth/login`, {
            data: { username: 'local', password: 'AegisAdmin123' },
        }).catch(() => {});
        const seeded = await request.post(`${BACKEND}/api/settings`, {
            data: {
                dataMode: 'SIM',
                dataScenario: 'stable',
                rpcUrl: 'https://e2e-sepolia.invalid',
                openRouterKey: 'sk-or-e2e-placeholder',
                riskAppetite: 'Balanced',
                targetHf: 1.25,
                frequency: 'Medium',
                maxGasClaim: 20,
            },
        });
        expect(seeded.ok()).toBeTruthy();

        await page.goto('/');
        const startNew = page.getByRole('button', { name: /Start New/i }).first();
        await expect(startNew).toBeVisible({ timeout: 15000 });
        await startNew.click();

        // Aggressive → target HF snaps to 1.20 in the modal.
        await page.locator('input[name="simulationName"]').fill(`Coupling ${Date.now()}`);
        await page.locator('select[name="riskAppetite"]').selectOption('Aggressive');
        await page.getByRole('button', { name: /Launch Agent/i }).click();
        await expect(page.getByRole('button', { name: /Stop Simulation/i })).toBeVisible({ timeout: 20000 });

        // The Settings page reads the SAME context — its Automation Parameters
        // section must reflect the new appetite (previously stale).
        await page.goto('/settings');
        await expect(page.getByText(/Automation Parameters|Otomasyon Parametreleri/i).first()).toBeVisible({ timeout: 15000 });
        const appetiteSelect = page.locator('select').filter({ has: page.getByRole('option', { name: /Aggressive — target HF 1\.20/ }) });
        await expect(appetiteSelect).toHaveValue('Aggressive');

        // And the Automation Parameters rules card on Yield Strategies must show
        // the new 1.20 target in its system rule (previously stale 1.25).
        await page.goto('/yield-strategies');
        await expect(page.getByText(/Health Factor < 1\.2/i).first()).toBeVisible({ timeout: 15000 });

        await request.post(`${BACKEND}/api/simulation/stop`);
    });
});
