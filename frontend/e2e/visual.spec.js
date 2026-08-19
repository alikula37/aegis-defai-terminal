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

// Horizontal overflow guard: the page must never scroll sideways and no element
// may poke past the right viewport edge (catches unwrapped flex rows, oversized
// metric figures and negative chart margins).
async function assertNoHorizontalOverflow(page) {
    const overflow = await page.evaluate(() => {
        const doc = document.documentElement;
        const pageOverflows = doc.scrollWidth > doc.clientWidth + 1;
        const offenders = [];
        for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.right > window.innerWidth + 1 && r.width > 0 && getComputedStyle(el).position !== 'fixed') {
                offenders.push(`${el.tagName.toLowerCase()}.${[...el.classList].slice(0, 3).join('.')} (right=${Math.round(r.right)})`);
            }
        }
        return { pageOverflows, offenders: offenders.slice(0, 8) };
    });
    expect(overflow.pageOverflows, `page scrollWidth > clientWidth; offenders: ${overflow.offenders.join(', ')}`).toBe(false);
}

test.describe('Visual regression', () => {
    test.use({ baseURL: 'http://localhost:5173' });

    test.beforeEach(async ({ request }) => {
        await request.post(`${BACKEND}/api/auth/login`, {
            data: { username: 'local', password: 'AegisAdmin123' },
        }).catch(() => {});
        // Determinism: stop + delete any simulation left by the functional
        // specs, so pages render their static idle/empty state (the live-data
        // page otherwise shows live prices/timestamps that shift every run).
        // Deleting a simulation cascades its settings row, so re-seed a fixed
        // settings state afterwards — otherwise the settings page height
        // flips between SIM (scenario select visible) and LIVE.
        await request.post(`${BACKEND}/api/simulation/stop`).catch(() => {});
        const list = await request.get(`${BACKEND}/api/simulations`).then(r => r.json()).catch(() => []);
        for (const sim of Array.isArray(list) ? list : []) {
            await request.delete(`${BACKEND}/api/simulation/${sim.id}`).catch(() => {});
        }
        await request.post(`${BACKEND}/api/settings`, {
            data: {
                dataMode: 'SIM',
                dataScenario: 'stable',
                rpcUrl: 'https://e2e-sepolia.invalid',
                openRouterKey: 'sk-or-e2e-placeholder',
                activeModel: 'google/gemini-2.5-flash-exp:free',
                brainMode: 'auto',
                riskAppetite: 'Balanced',
                frequency: 'Medium',
                targetHf: 1.25,
                maxGasClaim: 20,
            },
        }).catch(() => {});
    });

    test('live data page renders consistently', async ({ page }) => {
        await page.goto('/live-data');
        await expect(page.getByText(/Live Oracle Feed/i).first()).toBeVisible({ timeout: 15000 });
        // Wait for the WS status pill to settle on a definitive state — the
        // LIVE/OFFLINE badge flips while the socket connects, which would make
        // the screenshot non-deterministic across runs.
        await expect(page.locator('span', { hasText: /^(LIVE|OFFLINE)$/ }).first()).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveScreenshot('live-data.png', { maxDiffPixelRatio: 0.02 });
        await assertNoHorizontalOverflow(page);
    });

    test('overview idle state renders consistently', async ({ page }) => {
        await page.goto('/');
        await expect(page.getByRole('button', { name: /Start New/i }).first()).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveScreenshot('overview-idle.png', { maxDiffPixelRatio: 0.02 });
        await assertNoHorizontalOverflow(page);
    });

    test('settings page renders consistently', async ({ page }) => {
        await page.goto('/settings');
        // Heading role skips the (hidden-on-mobile) sidebar nav links.
        await expect(page.getByRole('heading', { name: /Settings|Ayarlar/i }).first()).toBeVisible({ timeout: 15000 });
        // Full-page: the Brain Mode card sits below the 720px fold, and a
        // viewport-only shot would never catch a regression in it.
        await expect(page).toHaveScreenshot('settings.png', { maxDiffPixelRatio: 0.02, fullPage: true });
        await assertNoHorizontalOverflow(page);
    });

    test('yield strategies page renders consistently', async ({ page }) => {
        await page.goto('/yield-strategies');
        await expect(page.getByRole('heading', { name: /Yield Strategies|Getiri Stratejileri/i }).first()).toBeVisible({ timeout: 15000 });
        await expect(page).toHaveScreenshot('yield-strategies.png', { maxDiffPixelRatio: 0.02 });
        await assertNoHorizontalOverflow(page);
    });

    test('analytics page renders consistently', async ({ page }) => {
        await page.goto('/analytics');
        await expect(page.getByText(/Strategy Analytics/i).first()).toBeVisible({ timeout: 15000 });
        // Wait for the opportunities dashboard (hero) to render its content and
        // for every panel to finish its fetch (spinners gone) so the screenshot
        // captures settled data/error states, not mid-load frames.
        await expect(page.getByText(/Live Opportunities|Canlı Fırsatlar/i).first()).toBeVisible({ timeout: 20000 });
        await expect(page.locator('.animate-spin')).toHaveCount(0, { timeout: 25000 });
        await expect(page).toHaveScreenshot('analytics.png', { maxDiffPixelRatio: 0.02, fullPage: true });
        await assertNoHorizontalOverflow(page);
    });
});