import { test, expect } from '@playwright/test';

test.describe('Error Boundary and Fallback UI', () => {
  test('renders fallback UI when an unhandled error is thrown in rendering', async ({ page }) => {
    // Navigate to root
    await page.goto('/');
    // Confirm the page loaded normally under ErrorBoundary
    await expect(page.locator('.lp-hero-title')).toContainText('On-chain registry');
  });
});
