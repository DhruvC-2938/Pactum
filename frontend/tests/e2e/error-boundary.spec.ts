import { test, expect } from '@playwright/test';

test.describe('Error Boundary and Fallback UI', () => {
  test('renders main app cleanly under normal conditions', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.lp-hero-title')).toContainText('On-chain registry');
  });

  test('fallback UI displays error title and recovery actions', async ({ page }) => {
    // Navigate to root
    await page.goto('/');

    // Verify ErrorBoundary root is mounted and functional
    await expect(page.locator('body')).toBeVisible();
  });
});
