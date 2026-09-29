import { expect, type Page, test } from '@playwright/test'

/** How far the page scrolls sideways — zero when nothing overflows the viewport. */
const horizontalOverflow = (page: Page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)

test.describe('the app shell at phone width (SAN-38)', () => {
  test.use({ viewport: { width: 375, height: 812 } })

  test('a signed-out visitor gets the sign-in surface, with no horizontal scroll', async ({
    page,
  }) => {
    await page.goto('/')

    await expect(page.getByRole('heading', { name: 'Sandlot' })).toBeVisible()
    // Clerk mounts its prebuilt UI asynchronously, under its stable `cl-` classes.
    await expect(page.locator('.cl-rootBox')).toBeVisible({ timeout: 15_000 })
    expect(await horizontalOverflow(page)).toBe(0)
  })

  test('the /design showcase is public: it renders signed out, without the sign-in surface', async ({
    page,
  }) => {
    await page.goto('/design')

    await expect(page.getByRole('button', { name: 'LOCK IT IN' })).toBeVisible({
      timeout: 10_000,
    })
    await expect(page.locator('.cl-rootBox')).toHaveCount(0)
  })
})
