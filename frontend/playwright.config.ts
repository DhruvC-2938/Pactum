import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  timeout: 30 * 1000,
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  // The host (this package) plus the two remotes it federates at runtime — see
  // ../docs/module-federation.md. All three must be running for the app (and the
  // module-federation.spec.ts suite in particular) to work; Playwright starts and tears down all
  // three for a single test run.
  //
  // Each is built then served via `vite preview` rather than `vite dev`: dev mode compiles
  // modules on demand per request, and Module Federation's remote-loading path touches enough
  // modules across three concurrently-cold dev servers that this raced with Vite's dependency
  // optimizer restarting mid-request (a Vite dev-server characteristic, not a bug in this app —
  // see module-federation.spec.ts). `vite preview` serves the same static assets a real
  // deployment would, sidestepping that entirely and more accurately validating the production
  // build besides. VITE_E2E_DIAGNOSTICS enables the referential-identity markers these tests read
  // off `window` (see e.g. contexts/WalletContext.tsx) — unset in every real deployment.
  webServer: [
    {
      command: 'npm run build && npm run preview',
      cwd: '../frontend-dashboard-remote',
      url: 'http://localhost:5174/remoteEntry.js',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: { VITE_E2E_DIAGNOSTICS: 'true' },
    },
    {
      command: 'npm run build && npm run preview',
      cwd: '../frontend-wizard-remote',
      url: 'http://localhost:5175/remoteEntry.js',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: { VITE_E2E_DIAGNOSTICS: 'true' },
    },
    {
      command: 'npm run build && npm run preview',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      env: { VITE_E2E_DIAGNOSTICS: 'true' },
    },
  ],
});
