import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

let tempVaultDir: string

// Disposable copy only. Links point at pages the shared fixture already has.
const RELATIONSHIP_NOTES: Record<string, string> = {
  // Custom keys holding wikilinks, next to a plain-text status.
  'project/sponsorships.md': '---\ntype: Project\nStatus: Open\nHas Measures:\n  - "[[Note B]]"\nHas Procedures:\n  - "[[Note C]]"\n---\n\n# Sponsorships\n\nWho funds the work.\n',
  // Single wikilink values on a built-in and a custom key.
  'project/start-laputa-app.md': '---\ntype: Project\nStatus: Active\nBelongs to: "[[Spring 2026]]"\nOwner: "[[Note B]]"\n---\n\n# Start Laputa App\n\nKickoff plan.\n',
}

function addRelationshipNotes(vaultDir: string) {
  for (const [file, content] of Object.entries(RELATIONSHIP_NOTES)) fs.writeFileSync(path.join(vaultDir, file), content)
}

async function openPageFromSearch(page: Page, title: string, fileStem: string) {
  await page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'Search', exact: true }).click()
  const finder = page.getByRole('dialog', { name: 'Find a page' })
  await finder.getByRole('combobox').fill(title)
  await finder.getByRole('group', { name: 'Pages' }).getByRole('option', { name: title, exact: true }).click()
  await expect(finder).not.toBeVisible()
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(fileStem, { timeout: 5_000 })
  // LeadingLight starts with the properties panel closed; open it the way a user does.
  await page.locator('[data-pane-active="true"]').getByRole('button', { name: 'Open the properties panel' }).click()
}

const property = (page: Page, label: string) => page.locator('[data-testid="editable-property"]').filter({ hasText: label })
// A relationship row shows its label next to the linked page; an empty suggestion row has no link.
const relationship = (page: Page, label: string, linkedPage: string) =>
  page.getByTestId('relationship-section-label').filter({ hasText: label }).locator('..').getByRole('button', { name: linkedPage, exact: true })

test.describe('Dynamic wikilink relationship detection', () => {
  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    addRelationshipNotes(tempVaultDir)
    await page.setViewportSize({ width: 1600, height: 900 })
    await openFixtureVault(page, tempVaultDir)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('wikilink fields render as relationships, plain-text fields as properties', async ({ page }) => {
    await openPageFromSearch(page, 'Sponsorships', 'sponsorships')

    const statusProp = property(page, 'Status')
    await expect(statusProp).toBeVisible({ timeout: 5_000 })
    await expect(statusProp.getByText('Open')).toBeVisible()

    await expect(property(page, 'Has Measures')).not.toBeVisible()
    await expect(relationship(page, 'Has Measures', 'Note B')).toBeVisible()
    await expect(property(page, 'Has Procedures')).not.toBeVisible()
    await expect(relationship(page, 'Has Procedures', 'Note C')).toBeVisible()
  })

  test('existing wikilink relationships still render correctly', async ({ page }) => {
    await openPageFromSearch(page, 'Start Laputa App', 'start-laputa-app')

    await expect(property(page, 'Status')).toBeVisible({ timeout: 5_000 })

    await expect(property(page, 'Belongs to')).not.toBeVisible()
    await expect(relationship(page, 'Belongs to', 'Spring 2026')).toBeVisible()

    await expect(property(page, 'Owner')).not.toBeVisible()
    await expect(relationship(page, 'Owner', 'Note B')).toBeVisible()
  })
})
