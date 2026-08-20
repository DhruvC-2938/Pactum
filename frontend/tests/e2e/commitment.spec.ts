import { test, expect } from '@playwright/test';

test.describe('Commitment Flow', () => {
  test.beforeEach(async ({ page }) => {
    // Mock Freighter API
    await page.addInitScript(() => {
      (window as any).freighter = {
        isConnected: () => Promise.resolve(true),
        isAllowed: () => Promise.resolve(true),
        getUserInfo: () => Promise.resolve({ publicKey: 'GCV7G...TEST' }),
        signTransaction: (tx: string) => Promise.resolve({ status: 'SUCCESS', signedTx: tx }),
      };
    });
  });

  test('User can view landing page, connect mock wallet, and submit a commitment', async ({ page }) => {
    // 1. User can view the landing page.
    await page.goto('/');
    await expect(page.locator('.lp-hero-title')).toContainText('On-chain registry');
    
    // 2. User can "connect" a mock wallet. (In this UI, we just launch the app which takes us to Dashboard)
    await page.click('#hero-launch-btn');
    
    // Verify Dashboard is active
    await expect(page.locator('#topbar-title')).toHaveText('Dashboard');

    // 3. User can navigate to the Create Commitment form.
    await page.click('#nav-create');
    
    // Verify Create Commitment page is active
    await expect(page.locator('.section-title').filter({ hasText: 'Create Commitment' })).toBeVisible();

    // 4. User can fill out the multi-step Create Commitment wizard.
    // Step 1: Counterparty
    await page.fill('#wizard-counterparty', 'GCV7G73HBBHMFHNK4I2U2XNIMV2A7H2LZ5SJZV2QBN56N74676YDFGXY');
    await page.click('button:has-text("Continue")');

    // Step 2: Terms & Conditions
    await expect(page.locator('#wizard-terms')).toBeVisible();
    await page.fill('#wizard-terms', 'Deliver 500 widgets by end of Q3');
    await page.click('button:has-text("Continue")');

    // Step 3: Deadline & Review
    await expect(page.locator('#wizard-dueat')).toBeVisible();
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dateString = futureDate.toISOString().slice(0, 16); // format: YYYY-MM-DDTHH:mm
    await page.fill('#wizard-dueat', dateString);

    // 5. User can submit the form.
    await page.locator('#page-create .wizard button:has-text("Create Commitment")').click();
    
    // Verify the commitment payload was prepared (terms hashed + due date converted)
    await expect(page.locator('.inline-alert').filter({ hasText: 'Commitment payload prepared' })).toBeVisible();
  });
});
