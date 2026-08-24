import { test, expect } from '@playwright/test';
import { installSigningFreighterMock } from './freighter-signing-mock';
import { getCommitmentOnChain } from './chain-helpers';

/**
 * Real end-to-end test against a local Soroban sandbox with the actual
 * RegistryContract deployed -- no mocked RPC responses, no mocked
 * `**\/commitments*` route. This is what issue #8 asks for: replacing
 * manual testnet clicks with a fast, repeatable local-sandbox run.
 *
 * SCOPE NOTE: as of writing, the frontend only implements create_commitment
 * end-to-end (see ISSUE_COMMENT_DRAFT.md) -- there's no attest/dispute/
 * resolve UI yet. This spec covers create_commitment through to the
 * dashboard showing it as "Pending", matching the real on-chain record.
 * attest -> dispute -> resolve_dispute coverage is a follow-up once that UI
 * exists (see the draft comment for the two scoping options put to the
 * issue author).
 *
 * Requires the sandbox + full stack running first:
 *   docker compose -f docker-compose.yml -f docker-compose.e2e.yml up -d
 *   ./scripts/e2e/wait-for-rpc.sh
 *   ./scripts/e2e/deploy-test-contract.sh
 */

const {
  E2E_ISSUER_ADDRESS,
  E2E_ISSUER_SECRET,
  E2E_COUNTERPARTY_ADDRESS,
  SOROBAN_NETWORK_PASSPHRASE,
} = process.env as Record<string, string>;

test.describe('create_commitment against local Soroban sandbox (#8)', () => {
  test.setTimeout(120_000);

  test.beforeEach(async ({ page }) => {
    if (!E2E_ISSUER_ADDRESS || !E2E_ISSUER_SECRET) {
      throw new Error(
        'E2E_ISSUER_ADDRESS / E2E_ISSUER_SECRET not set -- run scripts/e2e/deploy-test-contract.sh first.',
      );
    }

    await installSigningFreighterMock(page, {
      address: E2E_ISSUER_ADDRESS,
      secret: E2E_ISSUER_SECRET,
      networkPassphrase: SOROBAN_NETWORK_PASSPHRASE,
    });

    await page.goto('/');
  });

  test('creating a commitment lands on-chain and appears Pending on the dashboard', async ({
    page,
  }) => {
    // CreateCommitmentWizard's catch block does `console.error('[CreateCommitmentWizard] Soroban
    // error:', err)` with the raw error *before* decoding it into the generic toast label
    // (decodeRegistryContractError falls back to "Transaction Failed" for anything that isn't a
    // recognized `Error(Contract, #N)` code) -- capture it so a real submission/RPC failure here
    // shows its actual message instead of just "Transaction Failed".
    const consoleErrors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Connect the (mocked, but really-signing) Freighter wallet. Assertion pattern matches the
    // confirmed-working frontend/e2e/wallet-connect.spec.ts, not the unverified 'Connected' text
    // used in commitment-flow.spec.ts.
    const connectBtn = page.getByRole('button', { name: 'Connect Wallet' }).first();
    await expect(connectBtn).toBeVisible({ timeout: 15_000 });
    await connectBtn.click();
    await page.getByRole('button', { name: /Freighter/ }).click();
    const shortAddress = `${E2E_ISSUER_ADDRESS.slice(0, 6)}...${E2E_ISSUER_ADDRESS.slice(-4)}`;
    await expect(page.getByRole('button', { name: shortAddress })).toBeVisible();

    // Enter the app shell (landing page gates the nav behind "Launch App"),
    // then open the create wizard via its stable nav id.
    const launchBtn = page.locator('#hero-launch-btn');
    if (await launchBtn.isVisible()) {
      await launchBtn.click();
    }
    await page.locator('#nav-create').click();
    await expect(page.locator('#wizard-counterparty')).toBeVisible({ timeout: 10_000 });
    // Launch the create wizard. Selectors below match the real
    // CreateCommitmentWizard.tsx markup (#wizard-counterparty etc, same ids
    // used by frontend/e2e/contract-errors.spec.ts's fillWizardAndSubmit).
    await page.getByRole('button', { name: 'Create Commitment' }).click();
    // App.tsx defaults to the 'landing' page, which renders LandingPage instead of the
    // sidebar -- #nav-create doesn't exist in the DOM until it's dismissed.
    if (await page.locator('#hero-launch-btn').isVisible()) {
      await page.locator('#hero-launch-btn').click();
    }

    // Launch the create wizard via the nav button's id: its accessible name is
    // "Create Commitment navigation" (aria-label), not "Create Commitment", and the
    // wizard's own submit button shares that text too -- see commitment-flow.spec.ts's
    // "avoid strict mode violation" convention for the same #nav-create locator.
    // Wizard selectors below match the real CreateCommitmentWizard.tsx markup
    // (#wizard-counterparty etc, same ids used by contract-errors.spec.ts's fillWizardAndSubmit).
    await page.locator('#nav-create').click();

    await page.locator('#wizard-counterparty').fill(E2E_COUNTERPARTY_ADDRESS);
    await page.getByRole('button', { name: 'Continue' }).click();

    const terms = `E2E sandbox run ${Date.now()}`;
    await page.locator('#wizard-terms').fill(terms);
    await page.getByRole('button', { name: 'Continue' }).click();

    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 7);
    await page.locator('#wizard-dueat').fill(dueDate.toISOString().slice(0, 16));

    // Submit wizard using unique button id
    const submitBtn = page.locator('#wizard-submit-btn');
    await expect(submitBtn).toBeVisible({ timeout: 10_000 });
    await expect(submitBtn).toBeEnabled({ timeout: 10_000 });
    await submitBtn.click();

    // The real signing + RPC round-trip (submit -> poll for on-chain confirmation) can take up to
    // ~55s under CI load, so a real submission/simulation/confirmation error can surface well
    // after a fixed early check would look for it. Race the success transition against the error
    // toast instead of checking once up front, so a real failure fails fast with its actual
    // message -- enriched with the raw console.error CreateCommitmentWizard logs before decoding
    // it into the generic toast label -- instead of just timing out on the success locator.
    const errorToast = page.locator('#toast-container .toast.error').first();
    const outcome = await Promise.race([
      page
        .locator('#page-reputation.active')
        .waitFor({ state: 'attached', timeout: 65_000 })
        .then(() => 'success' as const),
      errorToast.waitFor({ state: 'visible', timeout: 65_000 }).then(() => 'error' as const),
    ]);

    if (outcome === 'error') {
      const toastMessage = await errorToast.innerText();
      const rawError = consoleErrors.find((line) =>
        line.includes('[CreateCommitmentWizard] Soroban error:'),
      );
      throw new Error(
        `Commitment creation failed with toast error: ${toastMessage}` +
          (rawError ? `\nRaw console error: ${rawError}` : ''),
      );
    }

    const commitmentId = 1;

    // Cross-check: what the UI just claimed happened is what actually
    // landed on-chain -- not just a plausible-looking success toast.
    const onChain = await getCommitmentOnChain(commitmentId, E2E_ISSUER_ADDRESS);
    expect(onChain.status).toBe('Pending');

    // Confirm the commitments list (fed by backend/indexer) picks up the same
    // commitment. This is the part that catches indexer/backend desync bugs --
    // the wizard succeeding doesn't guarantee the list's separate read path agrees.
    await page.locator('#nav-commitments').click();
    await expect(page.locator('#commitments-list-page')).toBeVisible({ timeout: 15_000 });

    const commitmentCard = page.locator('.commitment-item', { hasText: `Commitment #${commitmentId}` });
    await expect(commitmentCard).toBeVisible({ timeout: 25_000 }); // indexer poll latency
    await expect(commitmentCard.locator('.badge')).toHaveText(/Pending/i);
    // Now confirm the dashboard (fed by backend/indexer, not the wizard's
    // own state) picks up the same commitment as Pending. This is the part
    // that actually catches indexer/backend desync bugs -- the wizard
    // succeeding doesn't guarantee the dashboard's separate read path agrees.
    await page.getByRole('link', { name: 'Dashboard' }).click();
    // Now confirm the Commitments page (fed by backend/indexer, not the wizard's
    // own state) picks up the same commitment as Pending. This is the part that
    // actually catches indexer/backend desync bugs -- the wizard succeeding doesn't
    // guarantee the separate read path agrees. Deliberately not the Dashboard's
    // "Recent Commitments" card: that widget is static placeholder markup (hardcoded
    // "Commitment #4" etc, not commitmentsQuery-backed) and would never show this.
    await page.locator('#nav-commitments').click();

    const commitmentCard = page.locator('#commitments-list-page .commitment-item', {
      hasText: `Commitment #${commitmentId}`,
    });
    await expect(commitmentCard).toBeVisible({ timeout: 25_000 });
    await expect(commitmentCard.getByText('Pending')).toBeVisible();
  });
});
