import { expect, test } from '@playwright/test'

test('app renders without a JS error', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))

  await page.goto('/')
  await expect(page.locator('#root')).not.toBeEmpty({ timeout: 10_000 })

  expect(errors, `Unexpected JS errors:\n${errors.join('\n')}`).toHaveLength(0)
})
