import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let tempVaultDir: string

// Disposable copy only: every type uses the canonical `type:` field instead of the shared fixture's `Is A:`.
function useCanonicalTypeField(vaultDir: string) {
  for (const entry of fs.readdirSync(vaultDir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue
    const file = path.join(entry.parentPath, entry.name)
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(/^Is A:/m, 'type:'))
  }
  fs.mkdirSync(path.join(vaultDir, 'theme'))
  fs.writeFileSync(path.join(vaultDir, 'theme/default.md'), '---\ntype: Theme\n---\n\n# Default\n\nThe calm house theme.\n')
}

async function openPageFromSearch(page: Page, title: string, fileStem: string) {
  await page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'Search', exact: true }).click()
  const finder = page.getByRole('dialog', { name: 'Find a page' })
  await finder.getByRole('combobox').fill(title)
  await finder.getByRole('group', { name: 'Pages' }).getByRole('option', { name: title, exact: true }).click()
  await expect(finder).not.toBeVisible()
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(fileStem, { timeout: 5_000 })
}

// LeadingLight starts with the properties panel closed; open it the way a user does.
async function openPropertiesPanel(page: Page) {
  await page.locator('[data-pane-active="true"]').getByRole('button', { name: 'Open the properties panel' }).click()
}

test.describe('Canonical type field', () => {
  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    useCanonicalTypeField(tempVaultDir)
    await page.setViewportSize({ width: 1600, height: 900 })
    await openFixtureVault(page, tempVaultDir)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('sidebar shows type sections parsed from type: field', async ({ page }) => {
    const sidebar = page.getByRole('navigation')
    await expect(sidebar.getByRole('button', { name: 'Projects', exact: true })).toBeVisible({ timeout: 5_000 })
    await expect(sidebar.getByRole('button', { name: 'Notes', exact: true })).toBeVisible({ timeout: 5_000 })
  })

  test('theme notes display correctly with type: Theme', async ({ page }) => {
    // The theme note's type is read from `type:`, giving it its own section.
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Themes', exact: true })).toBeVisible({ timeout: 5_000 })
    await openPageFromSearch(page, 'Default', 'default')

    await expect(page.locator('[data-pane-active="true"] .bn-editor h1')).toHaveText('Default', { timeout: 5_000 })
  })

  test('type definition notes display correctly with type: Type', async ({ page }) => {
    await openPageFromSearch(page, 'Project', 'project')
    await openPropertiesPanel(page)

    const instancesLabel = page.getByText(/Instances \(\d+\)/)
    await expect(instancesLabel).toHaveText('Instances (1)', { timeout: 5_000 })
    await expect(instancesLabel.locator('..').getByRole('button', { name: 'Alpha Project' })).toBeVisible()
  })
})
