import { test, expect } from '@playwright/test';

const MOCK_ADDRESS = 'GCV7GMOCKADDRESS123456789012345678901234567890';

test.beforeEach(async ({ page }) => {
  // Mock Freighter Wallet
  await page.addInitScript(() => {
    (window as any).freighter = {
      isConnected: () => Promise.resolve(true),
      requestAccess: () => Promise.resolve({ address: MOCK_ADDRESS }),
      getAddress: () => Promise.resolve({ address: MOCK_ADDRESS }),
      isAllowed: () => Promise.resolve(true),
      signTransaction: (tx: string) => Promise.resolve({ status: 'SUCCESS', signedTx: tx }),
    };
  });

  // Mock API responses
  await page.route('**/reputation/**', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        address: MOCK_ADDRESS,
        fulfilled: 1,
        late: 0,
        breached: 0,
        total: 1
      }),
    });
  });

  await page.route('**/commitments*', async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([
        {
          id: 1,
          issuer: MOCK_ADDRESS,
          counterparty: 'GCV7GCOUNTERPARTY123456789012345678901234567890',
          terms_hash: 'mock_hash',
          due_at: Date.now() / 1000 + 86400,
          status: 'Pending',
          outcome: null
        }
      ]),
    });
  });

  await page.route('**/commitments', async route => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 2, status: 'Created' }),
      });
    } else {
      // This is handled by the wildcard above, but for completeness:
      await route.continue();
    }
  });

  await page.goto('/');
});

test('critical user journey: connect wallet -> create commitment -> view dashboard', async ({ page }) => {
  // 1. Connect Wallet
  const connectBtn = page.getByRole('button', { name: 'Connect Wallet' });
  await expect(connectBtn).toBeVisible();
  await connectBtn.click();

  // Verify connection status - based on the App.tsx we should see a connected state
  // Since we mocked isConnected: true and requestAccess, it should connect immediately
  await expect(page.getByText('Connected')).toBeVisible();

  // 2. Create Commitment
  // Navigate to creation (assuming there's a link or button to open the wizard)
  // If the wizard is a modal, we click the trigger.
  // Based on the Explore agent, CreateCommitmentWizard exists. 
  // I'll look for a "Create Commitment" link/button to open it.
  await page.getByRole('button', { name: 'Create Commitment' }).click();

  await expect(page.locator('#wizard-counterparty')).toBeVisible();
  await page.locator('#wizard-counterparty').fill('GCV7GCOUNTERPARTY123456789012345678901234567890');
  await page.locator('#wizard-terms').fill('Test commitment terms');
  await page.locator('#wizard-dueat').fill('2026-12-31');

  await page.getByRole('button', { name: 'Create Commitment' }).click();

  // Verify success - look for a success message or navigation
  await expect(page.getByText('Commitment created successfully')).toBeVisible();

  // 3. View Dashboard
  // Navigate to the dashboard page/section
  await page.getByRole('link', { name: 'Dashboard' }).click();

  // Verify the commitments list is visible and contains our mocked data
  await expect(page.locator('.commitment-list')).toBeVisible();
  await expect(page.getByText('mock_hash')).toBeVisible();
});

test('form validation errors appear on bad input', async ({ page }) => {
  await page.getByRole('button', { name: 'Create Commitment' }).click();

  // Submit empty form
  await page.getByRole('button', { name: 'Create Commitment' }).click();

  // Verify validation errors (zod/react-hook-form usually render error messages)
  // I'll assume the form shows "Required" or similar errors
  await expect(page.getByText(/required/i)).toBeVisible();
});

test('loading spinners display during network requests', async ({ page }) => {
  // Slow down the API response
  await page.route('**/reputation/**', async route => {
    await new Promise(resolve => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        address: MOCK_ADDRESS,
        fulfilled: 0,
        late: 0,
        breached: 0,
        total: 0
      }),
    });
  });

  await page.getByRole('link', { name: 'Dashboard' }).click();
  
  // Verify loading state (skeleton cards in ReputationDashboard)
  await expect(page.locator('div[style*="animation: pulse"]')).toBeVisible();
  
  // Wait for it to disappear
  await expect(page.locator('div[style*="animation: pulse"]')).not.toBeVisible({ timeout: 5000 });
});
