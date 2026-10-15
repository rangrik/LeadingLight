import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'
import { dispatchShortcutEvent } from './testBridge'

let tempVaultDir: string

const finder = (page: Page) => page.getByRole('dialog', { name: 'Find a page' })
const searchItem = (page: Page) => page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'Search', exact: true })

async function openFinderByShortcut(page: Page) {
  await dispatchShortcutEvent(page, {
    key: 'p', code: 'KeyP', ctrlKey: false, metaKey: true, shiftKey: false, altKey: false, bubbles: true, cancelable: true,
  })
  await expect(finder(page).getByRole('combobox')).toBeFocused({ timeout: 5_000 })
}

async function openFromNoteList(page: Page, title: string) {
  await page.getByTestId('note-list-container').getByText(title, { exact: true }).click()
  await expect(page.locator('[data-pane-active="true"] .ll-page-picker')).toContainText(title, { timeout: 5_000 })
}

test.describe('LeadingLight finder', () => {
  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('sidebar Search finds a page by its text, opens it, and Escape returns focus @smoke', async ({ page }) => {
    await searchItem(page).click()
    const query = finder(page).getByRole('combobox')
    await expect(query).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(finder(page)).not.toBeVisible()
    await expect(searchItem(page)).toBeFocused()

    await searchItem(page).click()
    // Only Note B's text says this; no title matches it.
    await query.fill('referenced by Alpha')
    const hit = finder(page).getByRole('group', { name: 'In page text' }).getByRole('option', { name: /Note B/ })
    await expect(hit).toContainText('referenced by Alpha Project', { timeout: 5_000 })
    await hit.click()
    await expect(finder(page)).not.toBeVisible()
    await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText('note-b', { timeout: 5_000 })
  })

  test('recent pages follow visit order, the open page first @smoke', async ({ page }) => {
    await openFromNoteList(page, 'Note B')
    await openFromNoteList(page, 'Note C')
    await openFromNoteList(page, 'Note B')

    await openFinderByShortcut(page)
    const recent = finder(page).getByRole('group', { name: 'Recent', exact: true }).getByRole('option')
    await expect(recent).toHaveText(['Note B', 'Note C'])
  })
})
