import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { triggerMenuCommand } from './testBridge'

let tempVaultDir: string

function slugifyTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

async function expectEditorFocused(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null
    return Boolean(active?.isContentEditable || active?.closest('[contenteditable="true"]'))
  }), { timeout: 5_000 }).toBe(true)
}

// New pages are one blank body block; nothing is typed here.
async function createUntitledNote(page: Page): Promise<void> {
  await page.locator('body').click()
  await triggerMenuCommand(page, 'file-new-note')
  await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(/untitled-page-\d+(?:-\d+)?/i, {
    timeout: 5_000,
  })
  const firstBlock = page.locator('.bn-editor .bn-block-content').first()
  await expect(firstBlock).toHaveAttribute('data-content-type', 'paragraph', { timeout: 5_000 })
  await firstBlock.click()
  await expectEditorFocused(page)
}

// New pages have no frontmatter, so the Inspector first offers to start it (this sets type Note).
async function initializePropertiesPanel(page: Page): Promise<void> {
  // Shown only while the Inspector is collapsed.
  const openPanelButton = page.getByTestId('breadcrumb-properties-button')
  if (await openPanelButton.count()) {
    await openPanelButton.first().click()
  }
  await expect(page.getByText('This note has no properties yet')).toBeVisible()
  await page.getByRole('button', { name: 'Initialize properties' }).click()
  await expect(page.getByTestId('type-selector').getByRole('combobox')).toContainText('Note')
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('@smoke newly created notes stay editable before any reselection', async ({ page }) => {
  const title = `Immediate Editability ${Date.now()}`
  const bodyMarker = `body edit ${Date.now()}`
  const propertyValue = `Owner ${Date.now()}`
  const renamedStem = slugifyTitle(title)
  const notePath = path.join(tempVaultDir, `${renamedStem}.md`)

  await createUntitledNote(page)

  await page.keyboard.type('# ')
  await expect(page.locator('.bn-block-content[data-content-type="heading"]').first()).toBeVisible()
  await page.keyboard.type(title, { delay: 10 })
  await page.keyboard.press('Enter')
  await page.keyboard.type(bodyMarker, { delay: 10 })

  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible({ timeout: 5_000 })
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(renamedStem, { timeout: 10_000 })
  await expect.poll(() => fs.existsSync(notePath), { timeout: 10_000 }).toBe(true)
  await expect.poll(() => fs.readFileSync(notePath, 'utf8'), { timeout: 10_000 }).toContain(bodyMarker)

  await initializePropertiesPanel(page)
  await expect(page.getByTestId('add-property-row')).toBeVisible()
  await page.getByTestId('add-property-row').click()
  await expect(page.getByTestId('add-property-form')).toBeVisible()
  await page.getByPlaceholder('Property').fill('Owner')
  await page.getByPlaceholder('Value').fill(propertyValue)
  await page.getByTestId('add-property-confirm').click()

  const ownerRow = page.getByTestId('editable-property').filter({ hasText: 'Owner' })
  await expect(ownerRow).toContainText(propertyValue)
  await expect.poll(() => fs.readFileSync(notePath, 'utf8'), { timeout: 10_000 }).toContain(`Owner: ${JSON.stringify(propertyValue)}`)
})

test('@smoke untouched newly created notes can be renamed and updated before reselection', async ({ page }) => {
  const renamedStem = `fresh-note-${Date.now()}`
  const propertyValue = `Queued ${Date.now()}`
  const renamedPath = path.join(tempVaultDir, `${renamedStem}.md`)

  await createUntitledNote(page)

  await page.getByTestId('breadcrumb-filename-trigger').dblclick()
  const renameInput = page.getByTestId('breadcrumb-filename-input')
  await expect(renameInput).toBeVisible({ timeout: 5_000 })
  await renameInput.fill(renamedStem)
  await renameInput.press('Enter')

  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(renamedStem, { timeout: 10_000 })
  await expect.poll(() => fs.existsSync(renamedPath), { timeout: 10_000 }).toBe(true)

  await initializePropertiesPanel(page)
  await page.getByTestId('add-property-row').click()
  await expect(page.getByTestId('add-property-form')).toBeVisible()
  await page.getByPlaceholder('Property').fill('Owner')
  await page.getByPlaceholder('Value').fill(propertyValue)
  await page.getByTestId('add-property-confirm').click()

  const ownerRow = page.getByTestId('editable-property').filter({ hasText: 'Owner' })
  await expect(ownerRow).toContainText(propertyValue)
  await expect.poll(() => fs.readFileSync(renamedPath, 'utf8'), { timeout: 10_000 }).toContain(`Owner: ${JSON.stringify(propertyValue)}`)
})
