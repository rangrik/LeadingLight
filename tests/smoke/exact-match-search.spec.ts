import fs from 'fs'
import path from 'path'
import { test, expect } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'

// The demo vault's curated exact-match scenario, copied into a disposable vault per test.
const EXACT_MATCH_SCENARIO = [
  'topic-writing.md',
  'writing-for-clarity-vs-writing-for-credit.md',
  'writing-weekly-rhythm.md',
]

let tempVaultDir: string

function finder(page: import('@playwright/test').Page) {
  return page.getByRole('dialog', { name: 'Find a page' })
}

// These tests rank results; shortcut routing has its own specs, so open the finder from the sidebar.
async function openQuickOpen(page: import('@playwright/test').Page) {
  await page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'Search', exact: true }).click()
  await expect(finder(page).getByRole('combobox')).toBeFocused()
}

/** Title of the selected (keyboard-chosen) result in the finder. */
async function getFirstResultTitle(page: import('@playwright/test').Page): Promise<string> {
  const titleSpan = finder(page).locator('[role="option"][aria-selected="true"] span.truncate')
  await titleSpan.first().waitFor({ timeout: 3000 })
  return (await titleSpan.first().textContent()) ?? ''
}

test.describe('Exact match search ranking', () => {
  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    for (const file of EXACT_MATCH_SCENARIO) {
      fs.copyFileSync(path.resolve('demo-vault-v2', file), path.join(tempVaultDir, file))
    }
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('exact title match appears as first result', async ({ page }) => {
    await openQuickOpen(page)
    // "Writing" is a Topic note in the demo vault; other notes have "Writing" as a prefix
    await finder(page).getByRole('combobox').fill('Writing')
    await page.waitForTimeout(300)

    const firstTitle = await getFirstResultTitle(page)
    expect(firstTitle).toBe('Writing')
  })

  test('case-insensitive exact match appears first', async ({ page }) => {
    await openQuickOpen(page)
    await finder(page).getByRole('combobox').fill('writing')
    await page.waitForTimeout(300)

    const firstTitle = await getFirstResultTitle(page)
    expect(firstTitle).toBe('Writing')
  })

  test('partial matches still appear below exact match', async ({ page }) => {
    await openQuickOpen(page)
    await finder(page).getByRole('combobox').fill('Writing')
    await page.waitForTimeout(300)

    // Should have multiple title results (exact + prefix/fuzzy matches)
    const resultRows = finder(page).getByRole('group', { name: 'Pages' }).getByRole('option')
    const count = await resultRows.count()
    expect(count).toBeGreaterThan(1)

    // First result is the exact match
    const firstTitle = await getFirstResultTitle(page)
    expect(firstTitle).toBe('Writing')
  })

  test('arrow keys navigate search results past the exact match', async ({ page }) => {
    await openQuickOpen(page)
    await finder(page).getByRole('combobox').fill('Writing')
    await page.waitForTimeout(300)

    // First result should be selected (exact match)
    const firstTitle = await getFirstResultTitle(page)
    expect(firstTitle).toBe('Writing')

    // ArrowDown moves to next result (a prefix or fuzzy match)
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(100)
    const secondTitle = await getFirstResultTitle(page)
    expect(secondTitle).not.toBe('Writing')
  })
})
