import { test, expect } from '@playwright/test'

test.describe('Predictive UI Prefetching', () => {
  test('Prefetches query when hovering preset address buttons', async ({ page }) => {
    let prefetchRequested = false

    await page.route('**/reputation/**', async (route) => {
      prefetchRequested = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          address: 'GB4UFBX57KE2RPEXB4NCPQHXL5UZL7HSFBVQ2YEZQDZ2DXR2X3CHHZX',
          fulfilled: 10,
          late: 1,
          breached: 0,
          total: 11,
        }),
      })
    })

    await page.goto('/')
    await page.click('#hero-launch-btn')
    await page.click('#nav-reputation')

    // Find and hover over the preset button
    const presetBtn = page.getByRole('button', { name: /Counterparty \(GB4U\.\.\.\)/i })
    await expect(presetBtn).toBeVisible()

    await presetBtn.hover()

    // Give a brief window for intent trigger and request dispatch
    await page.waitForTimeout(150)
    expect(prefetchRequested).toBe(true)
  })

  test('Respects Save-Data header and disables prefetching on metered connections', async ({ page }) => {
    let prefetchRequested = false

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'connection', {
        value: { saveData: true, effectiveType: '4g' },
        configurable: true,
      })
    })

    await page.route('**/reputation/**', async (route) => {
      prefetchRequested = true
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ address: 'test', fulfilled: 0, late: 0, breached: 0, total: 0 }),
      })
    })

    await page.goto('/')
    await page.click('#hero-launch-btn')
    await page.click('#nav-reputation')

    const presetBtn = page.getByRole('button', { name: /Counterparty \(GB4U\.\.\.\)/i })
    await expect(presetBtn).toBeVisible()

    await presetBtn.hover()
    await page.waitForTimeout(150)

    // With saveData = true, prefetch should not trigger
    expect(prefetchRequested).toBe(false)
  })
})
