import { test, expect, type Page } from '@playwright/test';

const MOCK_ADDRESS = 'GASV7ZZOPNYYFEPJ6N3GX4VINJELUQQDRX6UWWOO43F55CV6OBQUEGVK';
const COUNTERPARTY = 'GCM5SKB5PS3ZCUXZ4GPLIBY42E63ILOT2EAIIT4UWGDFYOULCTLTRMMB';
const SHORT_ADDRESS = 'GASV7Z...EGVK';

/**
 * Simulates the Freighter browser extension content script (postMessage protocol).
 * Must be self-contained: Playwright serializes init scripts via toString().
 */
async function installFreighterMock(page: Page) {
  await page.addInitScript(
    ({ mockAddress }: any) => {
      (window as any).freighter = {};
      window.addEventListener('message', (event: MessageEvent) => {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== 'FREIGHTER_EXTERNAL_MSG_REQUEST') return;

        let response: Record<string, unknown> | null = null;
        switch (data.type) {
          case 'REQUEST_CONNECTION_STATUS':
            response = { isConnected: true };
            break;
          case 'REQUEST_PUBLIC_KEY':
          case 'REQUEST_ACCESS':
            response = { publicKey: mockAddress };
            break;
          case 'REQUEST_NETWORK':
            response = {
              network: 'TESTNET',
              networkPassphrase: 'Test SDF Network ; September 2015',
            };
            break;
          case 'REQUEST_NETWORK_DETAILS':
            response = {
              networkDetails: {
                network: 'TESTNET',
                networkUrl: 'https://horizon-testnet.stellar.org',
                networkPassphrase: 'Test SDF Network ; September 2015',
                sorobanRpcUrl: 'https://soroban-testnet.stellar.org',
              },
            };
            break;
          case 'REQUEST_ALLOWED_STATUS':
            response = { isAllowed: true };
            break;
          default:
            return;
        }

        window.postMessage(
          {
            source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE',
            messagedId: data.messageId,
            ...response,
          },
          window.location.origin,
        );
      });
    },
    { mockAddress: MOCK_ADDRESS },
  );
}

test.beforeEach(async ({ page }) => {
  await installFreighterMock(page);

  // Mock API responses
  await page.route('**/reputation/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        address: MOCK_ADDRESS,
        fulfilled: 1,
        late: 0,
        breached: 0,
        total: 1,
      }),
    });
  });

  await page.route('**/commitments*', async (route) => {
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
            outcome: null,
          },
        ]),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('**/commitments', async (route) => {
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

test('critical user journey: connect wallet -> create commitment -> view dashboard', async ({
  page,
}) => {
  // 1. Connect the wallet from the landing page
  await page.getByRole('button', { name: 'Connect Wallet' }).click();
  await page.getByRole('button', { name: /Freighter/ }).click();
  await expect(page.getByRole('button', { name: SHORT_ADDRESS })).toBeVisible();

  await expect(page.getByText('Connected')).toBeVisible();

  // 2. Create Commitment
  await page.getByRole('button', { name: 'Create Commitment' }).click();

  // Step 1: Counterparty
  await expect(page.getByLabel('Counterparty Address')).toBeVisible();
  await page
    .getByLabel('Counterparty Address')
    .fill('GCV7GCOUNTERPARTY123456789012345678901234567890');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: Terms
  await expect(page.getByLabel('Terms / Description')).toBeVisible();
  await page.getByLabel('Terms / Description').fill('Test commitment terms');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: Due Date
  await expect(page.getByLabel('Due Date')).toBeVisible();
  await page.getByLabel('Due Date').fill('2026-12-31T12:00');
  await page.locator('#wizard-terms').fill('Deliver 500 widgets by end of Q3');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Verify success
  await expect(page.getByText('Commitment created successfully')).toBeVisible();

  // 3. View Dashboard
  await page.getByRole('link', { name: 'Dashboard' }).click();

  await expect(page.locator('.commitment-list')).toBeVisible();
  await expect(page.getByText('mock_hash')).toBeVisible();
});

test('form validation errors appear on bad input', async ({ page }) => {
  await page.click('#hero-launch-btn');
  await page.click('#nav-create');

  // Try to continue without filling counterparty
  await page.getByRole('button', { name: 'Continue' }).click();

  // Verify validation error
  await expect(page.getByText(/required/i)).toBeVisible();
});

test('loading spinners display during network requests', async ({ page }) => {
  await page.route('**/reputation/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        address: MOCK_ADDRESS,
        fulfilled: 0,
        late: 0,
        breached: 0,
        total: 0,
      }),
    });
  });

  await page.getByRole('link', { name: 'Dashboard' }).click();

  await expect(page.locator('div[style*="animation: pulse"]')).toBeVisible();
  await expect(page.locator('div[style*="animation: pulse"]')).not.toBeVisible({ timeout: 5000 });
});
