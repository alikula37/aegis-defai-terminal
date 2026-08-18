// Visual regression: stable, deterministic screenshots of the app shell and
// static pages. Dynamic pages (running-simulation charts fed by live WS) are
// intentionally excluded — their pixels change every cycle.
//
// Baselines live in e2e/visual-snapshots/* and are committed. Regenerate with:
//   npx playwright test e2e/visual.spec.js --update-snapshots
// CI runs these in the e2e job (Faz 4) so a stray layout/color regression
// fails the build.
import { test, expect } from '@playwright/test';

const BACKEND = 'http://localhost:3001';

test.describe('Visual regression', () => {
    test.use({ baseURL: 'http://localhost:5173' });

    test.beforeEach(async ({ request }) => {
        await request.post(`${BACKEND}/api/auth/login`, {
            data: { username: 'local', password: 'AegisAdmin123' },
        }).catch(() => {});
    });

    test('live data page renders consistently', async ({ page }) => {
        await page.goto('/live-data');
        await expect(page.getByText(/Live Oracle Feed/i).first()).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveScreenshot('live-data.png', { maxDiffPixelRatio: 0.02 });
    });

    test('overview idle state renders consistently', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('button', { name: /Start New/i }).first()).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveScreenshot('overview-idle.png', { maxDiffPixelRatio: 0.02 });
    });

    test('settings page renders consistently', async ({ page }) => {
        await page.goto('/settings');
        await expect(page.getByText(/Settings|Ayarlar/i).first()).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveScreenshot('settings.png', { maxDiffPixelRatio: 0.02 });
    });

    test('yield strategies page renders consistently', async ({ page }) => {
        await page.goto('/yield-strategies');
        await expect(page.getByText('AEGIS DeFAI').first()).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveScreenshot('yield-strategies.png', { maxDiffPixelRatio: 0.02 });
    });
});