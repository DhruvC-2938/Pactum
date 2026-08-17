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
    if (route.request().method() === 'GET') {
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
    } else {
      await route.continue();
    }
  });

  await page.route('**/commitments', async route => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 2, status: 'Created' }),
      });
    } else {
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

  await expect(page.getByText('Connected')).toBeVisible();

  // 2. Create Commitment
  await page.getByRole('button', { name: 'Create Commitment' }).click();

  // Step 1: Counterparty
  await expect(page.getByLabel('Counterparty Address')).toBeVisible();
  await page.getByLabel('Counterparty Address').fill('GCV7GCOUNTERPARTY123456789012345678901234567890');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: Terms
  await expect(page.getByLabel('Terms / Description')).toBeVisible();
  await page.getByLabel('Terms / Description').fill('Test commitment terms');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: Due Date
  await expect(page.getByLabel('Due Date')).toBeVisible();
  await page.getByLabel('Due Date').fill('2026-12-31T12:00');

  await page.getByRole('button', { name: 'Create Commitment' }).click();

  // Verify success
  await expect(page.getByText('Commitment created successfully')).toBeVisible();

  // 3. View Dashboard
  await page.getByRole('link', { name: 'Dashboard' }).click();

  await expect(page.locator('.commitment-list')).toBeVisible();
  await expect(page.getByText('mock_hash')).toBeVisible();
});

test('form validation errors appear on bad input', async ({ page }) => {
  await page.getByRole('button', { name: 'Create Commitment' }).click();

  // Try to continue without filling counterparty
  await page.getByRole('button', { name: 'Continue' }).click();

  // Verify validation error
  await expect(page.getByText(/required/i)).toBeVisible();
});

test('loading spinners display during network requests', async ({ page }) => {
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
  
  await expect(page.locator('div[style*="animation: pulse"]')).toBeVisible();
  await expect(page.locator('div[style*="animation: pulse"]')).not.toBeVisible({ timeout: 5000 });
});
