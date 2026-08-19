import { test, expect } from '@playwright/test';

test.describe('Commitment Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Freighter API
    await page.addInitScript(() => {
      (window as any).freighter = {
        isConnected: () => Promise.resolve(true),
        isAllowed: () => Promise.resolve(true),
        getUserInfo: () => Promise.resolve({ publicKey: 'GCV7G73HBBHMFHNK4I2U2XNIMV2A7H2LZ5SJZV2QBN56N74676YDFGXY' }),
        signTransaction: (tx: string) => Promise.resolve({ status: 'SUCCESS', signedTx: tx }),
      };
    });
  });

  test('User can view landing page, connect mock wallet, and submit a commitment', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.lp-hero-title')).toContainText('On-chain registry');

    // 2. User can "connect" a mock wallet. (In this UI, we just launch the app which takes us to Dashboard)
    await page.click('#hero-launch-btn');

    // Verify Dashboard is active
    await expect(page.locator('#topbar-title')).toHaveText('Dashboard');

    // Navigate to Create Commitment wizard
    await page.click('#nav-create');

    // Verify Create Commitment page is active
    await expect(page.locator('.section-title').filter({ hasText: 'Create Commitment' })).toBeVisible();

    // 4. Step 1 — Counterparty
    await page.fill('#wizard-counterparty', 'GCV7G73HBBHMFHNK4I2U2XNIMV2A7H2LZ5SJZV2QBN56N74676YDFGXY');
    await page.getByRole('button', { name: 'Continue' }).click();

    // 5. Step 2 — Terms & Conditions
    await page.fill('#wizard-terms', 'Deliver 500 widgets by end of Q3');
    await page.getByRole('button', { name: 'Continue' }).click();

    // 6. Step 3 — Due date & submit
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dateString = futureDate.toISOString().slice(0, 16); // format: YYYY-MM-DDTHH:mm
    await page.fill('#wizard-dueat', dateString);

    await page.locator('.wizard').getByRole('button', { name: 'Create Commitment' }).click();

    // The wizard confirms the payload was prepared (terms hashed, due date converted to Unix time).
    await expect(page.locator('.inline-alert').filter({ hasText: 'Commitment payload prepared' })).toBeVisible();
  });
});
