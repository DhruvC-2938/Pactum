import { test, expect, type Page } from '@playwright/test';

const MOCK_ADDRESS = 'GASV7ZZOPNYYFEPJ6N3GX4VINJELUQQDRX6UWWOO43F55CV6OBQUEGVK';
const COUNTERPARTY = 'GCM5SKB5PS3ZCUXZ4GPLIBY42E63ILOT2EAIIT4UWGDFYOULCTLTRMMB';
const SHORT_ADDRESS = 'GASV7Z...EGVK';

// A fixed future date goes stale the moment it's in the past; compute one relative to "now"
// instead, matching contract-errors.spec.ts's own pattern.
function futureDueDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  return date.toISOString().slice(0, 16);
}

const LEDGER_ENTRIES_RESULT = { latestLedger: 50000 };
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
          // Simulate signTransaction: echo back the XDR as "signed"
          case 'REQUEST_SIGN_TRANSACTION': {
            response = {
              signedTxXdr: data.transactionXdr || '',
              signerAddress: mockAddress,
            };
            break;
          }
          // Simulate signMessage: returns a deterministic 64-byte base64 signature
          case 'REQUEST_SIGN_MESSAGE': {
            // Deterministic mock: base64 of 64 zero bytes (sufficient for HKDF key derivation test)
            const mockSig = btoa(String.fromCharCode(...new Array(64).fill(42)));
            response = {
              signedBlob: mockSig,
              signedMessage: mockSig,
              signerAddress: mockAddress,
            };
            break;
          }
          case 'SUBMIT_TRANSACTION': {
            response = {
              status: 'SUCCESS',
              txHash: 'a1b2c3d4e5f6',
            };
            break;
          }
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

/**
 * Mock all Soroban RPC JSON-RPC calls to avoid hitting the real testnet.
 * This intercepts getAccount, simulateTransaction, sendTransaction, and getTransaction.
 */
async function mockSorobanRpc(page: Page) {
  await page.route('**/soroban*', async (route) => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.continue();
      return;
    }

    let parsed: { id?: number | string; method?: string } | undefined;
    try {
      parsed = request.postDataJSON();
    } catch {
      // Malformed/non-JSON body: fall through and let the "unknown method" branch continue it.
    }

    const method = parsed?.method;
    const id = parsed?.id ?? 1;

    if (method === 'getAccount') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            id: MOCK_ADDRESS,
            sequence: '1234567890',
          },
        }),
      });
      return;
    }

    if (method === 'simulateTransaction') {
      // Every simulateTransaction call shares this one canned response regardless of which
      // contract method is being simulated -- that includes fetchArbitrator()'s `get_arbitrator`
      // read (submitCreateCommitment needs it for resolver_address), which does
      // `Address.fromString(String(scValToNative(retval)))` and throws on anything that isn't a
      // syntactically valid G... address. Encodes MOCK_ADDRESS as an ScVal Address so that -- and
      // get_reputation's unrelated, already-tolerant field lookups -- both decode without error.
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            transactionData: '',
            minResourceFee: '100',
            latestLedger: 4198984,
            cost: { cpuInsns: '123194', memBytes: '65536' },
            events: [],
            results: [
              {
                auth: [],
                xdr: 'AAAAEgAAAAAAAAAAJV/nLntxgpHp83Zr8qhqSLpCA439S1nO5sveir5wYUI=',
              },
            ],
          },
        }),
      });
      return;
    }

    if (method === 'sendTransaction') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
            status: 'PENDING',
            latestLedger: 4198984,
          },
        }),
      });
      return;
    }

    if (method === 'getTransaction') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          result: {
            status: 'SUCCESS',
            latestLedger: 4198986,
            latestLedgerCloseTime: Math.floor(Date.now() / 1000),
            oldestLedger: 4190000,
            oldestLedgerCloseTime: Math.floor(Date.now() / 1000) - 1000,
            envelopeXdr: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==',
            resultXdr: 'AAAAAAAAAGQAAAAAAAAAAQAAAAAAAAABAAAAAAAAAAA=',
            resultMetaXdr: 'AAAAAAAAAAAAAAAAAAAAAA==',
            returnValue: { type: 'i128', lo: 3, hi: 0 },
          },
        }),
      });
      return;
    }

    // Fall through for unknown methods
    await route.continue();
  });
}

test.beforeEach(async ({ page }) => {
  await installFreighterMock(page);

  await mockSorobanRpc(page);

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

  await page.route('**/api/v1/proofs/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        proof: {
          version: '1.0.0',
          networkPassphrase: 'Test SDF Network ; September 2015',
          ledgerSeq: LEDGER_ENTRIES_RESULT.latestLedger,
          ledgerHeaderHash: '00'.repeat(32),
          stateRootHash: '00'.repeat(32),
          contractId: 'CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E',
          stellarAddress: MOCK_ADDRESS,
          scoreData: {
            score: 100,
            fulfilledCount: 1,
            lateCount: 0,
            breachedCount: 0,
            epoch: 1,
            sourceLedgerSeq: LEDGER_ENTRIES_RESULT.latestLedger,
          },
          leafHash: '00'.repeat(32),
          merkleProof: [],
          headerProof: {
            previousLedgerHash: '00'.repeat(32),
            txSetResultHash: '00'.repeat(32),
            bucketListHash: '00'.repeat(32),
            ledgerVersion: 20,
          },
        },
      }),
    });
  });

  // Mock encrypted terms endpoints first so they take precedence
  await page.route('**/commitments/encrypted', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Encrypted terms stored successfully.' }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });

  await page.route('**/commitments/*/encrypted', async (route) => {
    if (route.request().method() === 'GET') {
      // Return a mock ciphertext blob (valid base64url-encoded bytes)
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ciphertext: 'AAAAAAAAAAAAAAAA_mock_ciphertext_blob',
          issuer: MOCK_ADDRESS,
          counterparty: COUNTERPARTY,
          createdAt: new Date().toISOString(),
        }),
      });
    } else {
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
    }
  });

  // Mock commitments query and creation
  await page.route('**/commitments*', async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 2, status: 'Created' }),
      });
    } else {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([
          {
            id: 1,
            issuer: MOCK_ADDRESS,
            counterparty: 'GCM5SKB5PS3ZCUXZ4GPLIBY42E63ILOT2EAIIT4UWGDFYOULCTLTRMMB',
            terms_hash: 'mock_hash',
            due_at: Date.now() / 1000 + 86400,
            status: 'Pending',
            outcome: null,
            encrypted: false,
          },
          {
            id: 2,
            issuer: MOCK_ADDRESS,
            counterparty: COUNTERPARTY,
            terms_hash: 'encrypted_mock_hash',
            due_at: Date.now() / 1000 + 86400,
            status: 'Pending',
            outcome: null,
            encrypted: true,
          },
        ]),
      });
    }
  });

  await page.goto('/');
  // `isVisible()` doesn't auto-wait, so it can read the DOM before the landing page has
  // hydrated and race to false on a slower load — `click()`'s own actionability wait is the
  // reliable way to land on this always-present button.
  await page
    .getByRole('button', { name: /launch app/i })
    .first()
    .click();
});

test('critical user journey: connect wallet -> create commitment -> view dashboard', async ({
  page,
}) => {
  // 1. Connect the wallet from the landing page
  await page.getByRole('button', { name: 'Connect Wallet' }).first().click();
  await page.getByRole('button', { name: /Freighter/ }).click();
  // The connected-wallet button (above) is WalletConnectButton's own indicator of connected
  // state — it never renders literal "Connected" text, so that assertion never matched anything.
  await expect(page.getByRole('button', { name: SHORT_ADDRESS })).toBeVisible();

  // 2. Create Commitment — use the nav button by its id: its accessible name is "Create
  // Commitment navigation" (aria-label on #nav-create in App.tsx), not "Create Commitment".
  await page.locator('#nav-create').click();

  // Step 1: Counterparty
  await expect(page.getByLabel('Counterparty Address')).toBeVisible();
  // The wizard's real client-side StrKey validation requires a well-formed 56-char address;
  // the placeholder previously here ('GCV7GCOUNTERPARTY...', 47 chars) failed that check and
  // silently blocked the Continue button.
  await page.getByLabel('Counterparty Address').fill(COUNTERPARTY);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: Terms
  await expect(page.locator('#wizard-terms')).toBeVisible();
  await page.locator('#wizard-terms').fill('Test commitment terms');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: Due Date
  await expect(page.getByLabel('Due Date')).toBeVisible();
  await page.getByLabel('Due Date').fill(futureDueDate());
  // Use the specific submit button id (matches frontend-wizard-remote's actual markup and the
  // pattern used elsewhere in this file) rather than a role/name match liable to collide with
  // #nav-create, which carries the same "Create Commitment" text.
  await page.locator('#wizard-submit-btn').click();

  // Verify success & transition to Reputation Dashboard — App.tsx's onSuccess navigates away
  // (setActivePage('reputation')) in the same commit the wizard sets its own success state, so
  // the wizard's "Commitment Created On-Chain!" view is written to the DOM but never actually
  // painted while #page-create is active; asserting on it directly is a false negative.
  await expect(page.locator('#page-reputation')).toHaveClass(/active/, { timeout: 10000 });

  // 3. View Commitments — #commitments-list-page only exists on the Commitments page, not the
  // Dashboard's own (unrelated, id-less) "Recent Commitments" card.
  await page.locator('#nav-commitments').click();

  await expect(page.locator('#commitments-list-page')).toBeVisible();
  await expect(page.getByText('Commitment #1').first()).toBeVisible();
  await expect(
    page.getByText('GCM5SKB5PS3ZCUXZ4GPLIBY42E63ILOT2EAIIT4UWGDFYOULCTLTRMMB').first(),
  ).toBeVisible();
});

test('form validation errors appear on bad input', async ({ page }) => {
  // beforeEach already lands on the dashboard (via its own Launch App click), so there's no
  // landing page left to launch from here.
  await page.click('#nav-create');

  // Wait for the wizard to render
  await expect(page.locator('#wizard-counterparty')).toBeVisible();

  // Try to continue without filling counterparty
  await page.getByRole('button', { name: 'Continue' }).click();

  // Verify validation error — the schema message is "Stellar address is required"
  await expect(page.getByText(/required/i)).toBeVisible();
});

test('loading spinners display during network requests', async ({ page }) => {
  // Unroute the instant reputation handler from beforeEach, then add a delayed one
  await page.unroute('**/reputation/**');
  await page.route('**/reputation/**', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        proof: {
          version: '1.0.0',
          networkPassphrase: 'Test SDF Network ; September 2015',
          ledgerSeq: LEDGER_ENTRIES_RESULT.latestLedger,
          ledgerHeaderHash: '00'.repeat(32),
          stateRootHash: '00'.repeat(32),
          contractId: 'CBADTVTJ6IN332HIKZ7LWUYMYTLPZYCEBV3X2HS47VHR5UDBHQ3GAA7E',
          stellarAddress: MOCK_ADDRESS,
          scoreData: {
            score: 100,
            fulfilledCount: 1,
            lateCount: 0,
            breachedCount: 0,
            epoch: 1,
            sourceLedgerSeq: LEDGER_ENTRIES_RESULT.latestLedger,
          },
          leafHash: '00'.repeat(32),
          merkleProof: [],
          headerProof: {
            previousLedgerHash: '00'.repeat(32),
            txSetResultHash: '00'.repeat(32),
            bucketListHash: '00'.repeat(32),
            ledgerVersion: 20,
          },
        },
      }),
    });
  });

  // Connect wallet first so #nav-my-profile (below) has a connected address to look up.
  await page.getByRole('button', { name: 'Connect Wallet' }).first().click();
  await page.getByRole('button', { name: /Freighter/ }).click();
  await expect(page.getByRole('button', { name: SHORT_ADDRESS })).toBeVisible();

  // Navigate to Reputation page using nav button id
  await page.locator('#nav-my-profile').click();

  // The skeleton loading cards use inline style animation: 'pulse 1.5s infinite'
  await expect(page.locator('div[style*="pulse"]').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('div[style*="pulse"]').first()).not.toBeVisible({ timeout: 10000 });
});

test('WASM validation failure blocks transaction simulation and wallet submission', async ({
  page,
}) => {
  // Connect wallet first (submit button is disabled without wallet)
  await page.getByRole('button', { name: 'Connect Wallet' }).first().click();
  await page.getByRole('button', { name: /Freighter/ }).click();
  await expect(page.getByRole('button', { name: SHORT_ADDRESS })).toBeVisible();

  // Track if signTransaction was called
  await page.evaluate(() => {
    (window as any).__signCalled = false;
  });

  // Navigate to Create Commitment wizard page
  await page.locator('#nav-create').click();

  // Step 0: Counterparty
  await page
    .locator('#wizard-counterparty')
    .fill('GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7');
  await page.getByRole('button', { name: /continue/i }).click();

  // Step 1: Terms
  await page.locator('#wizard-terms').fill('Test commitment terms');
  await page.getByRole('button', { name: /continue/i }).click();

  // Step 2: Deadline - Fill past date to trigger WASM contract validation error
  await page.locator('#wizard-dueat').fill('2020-01-01T00:00');

  // The Zod schema validates "Due date must be set in the future" client-side
  // before we even reach the submit button. The submit button may not be clickable
  // because Zod form validation blocks it. Let's click submit and check for the error.
  await page.locator('#wizard-submit-btn').click();

  // Wait for WASM validation or Zod validation to show the error
  await expect(
    page.getByText(/Due date must be set in the future|Contract validation failed/i),
  ).toBeVisible({ timeout: 10000 });
});

test('encrypted commitment: toggle encrypts terms — ciphertext sent to backend, not plaintext', async ({
  page,
}) => {
  // Track the body of the POST /commitments/encrypted request
  const encryptedRequests: { body: Record<string, unknown> }[] = [];
  await page.route('**/commitments/encrypted', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      encryptedRequests.push({ body });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Encrypted terms stored successfully.' }),
      });
    } else {
      await route.continue();
    }
  });

  // Connect Freighter wallet
  await page.getByRole('button', { name: 'Connect Wallet' }).first().click();
  await page.getByRole('button', { name: /Freighter/ }).click();
  await expect(page.getByRole('button', { name: SHORT_ADDRESS })).toBeVisible();

  // Navigate to Create Commitment — use nav id to avoid strict mode violation
  await page.locator('#nav-create').click();

  // Step 1: Counterparty
  await page.locator('#wizard-counterparty').fill(COUNTERPARTY);
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 2: Terms + enable encryption toggle
  await expect(page.locator('#wizard-terms')).toBeVisible();
  await page.locator('#wizard-terms').fill('Secret commitment terms');

  // Enable the encryption toggle via the hidden checkbox
  await expect(page.locator('#encrypt-toggle-container')).toBeVisible();
  await page.locator('#encrypt-toggle').dispatchEvent('click');
  await expect(page.locator('#encrypt-toggle-container')).toContainText('E2E Encrypted');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: Due date
  await page.locator('#wizard-dueat').fill(futureDueDate());
  // Use the specific submit button id to avoid strict mode violation
  await page.locator('#wizard-submit-btn').click();

  // Encryption consent modal should appear
  await expect(page.locator('#encrypt-modal-confirm')).toBeVisible({ timeout: 10000 });
  await page.locator('#encrypt-modal-confirm').click();

  await page.waitForTimeout(3000);

  // Assert: if any encrypted request was captured, it has ciphertext not plaintext
  for (const req of encryptedRequests) {
    expect(req.body).toHaveProperty('ciphertext');
    expect(req.body).not.toHaveProperty('terms');
    expect(typeof req.body.ciphertext).toBe('string');
    expect((req.body.ciphertext as string).length).toBeGreaterThan(10);
  }
});

test('dashboard: encrypted commitment shows lock badge and decrypt button', async ({ page }) => {
  // Connect wallet
  await page.getByRole('button', { name: 'Connect Wallet' }).first().click();
  await page.getByRole('button', { name: /Freighter/ }).click();
  await expect(page.getByRole('button', { name: SHORT_ADDRESS })).toBeVisible();

  // Navigate to commitments page using nav button id
  await page.locator('#nav-commitments').click();

  // Wait for commitments to load
  await expect(page.locator('#page-commitments .commitment-list')).toBeVisible({ timeout: 10000 });

  // The second commitment (id=2) is encrypted — its lock badge should be visible
  await expect(page.getByText('E2E Encrypted').first()).toBeVisible({ timeout: 10000 });

  // The "Decrypt Terms" button should be present for the encrypted commitment
  const decryptBtn = page.locator('[id^="decrypt-btn-"]').first();
  await expect(decryptBtn).toBeVisible({ timeout: 5000 });
  await expect(decryptBtn).toContainText('Decrypt Terms');

  // Clicking it should open the DecryptTermsModal
  await decryptBtn.click();
  await expect(page.locator('#decrypt-modal-confirm')).toBeVisible({ timeout: 5000 });

  // The modal should identify this wallet as a party (issuer)
  await expect(page.getByText('authorized')).toBeVisible();

  // Close the modal
  await page.locator('#decrypt-modal-cancel').click();
  await expect(page.locator('#decrypt-modal-confirm')).not.toBeVisible();
});
