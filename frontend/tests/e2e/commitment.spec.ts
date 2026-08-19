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
    
    const heroBtn = page.locator('#hero-launch-btn');
    await expect(heroBtn).toBeVisible();
    await heroBtn.click();
    
    // Verify Dashboard is active
    await expect(page.locator('#topbar-title')).toHaveText('Dashboard');

    // Navigate to Create Commitment wizard
    await page.click('#nav-create');
    
    // Step 0: Counterparty
    await page.fill('#wizard-counterparty', 'GCV7G73HBBHMFHNK4I2U2XNIMV2A7H2LZ5SJZV2QBN56N74676YDFGXY');
    await page.getByRole('button', { name: /Continue/i }).click();

    // Step 1: Terms
    await page.fill('#wizard-terms', 'Deliver 500 widgets by end of Q3');
    await page.getByRole('button', { name: /Continue/i }).click();
    
    // Step 2: Due Date
    const futureDate = new Date();
    futureDate.setDate(futureDate.getDate() + 7);
    const dateString = futureDate.toISOString().slice(0, 16);
    await page.fill('#wizard-dueat', dateString);

    // Final step: Create Commitment form submit button
    const submitBtn = page.locator('.wizard-nav').getByRole('button', { name: 'Create Commitment' });
    await expect(submitBtn).toBeVisible();
    await submitBtn.click();

    // Verify submitted payload confirmation is rendered
    await expect(page.locator('.inline-alert').filter({ hasText: 'Commitment payload prepared' })).toBeVisible();
  });
});
