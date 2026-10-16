import { expect, test, type Page } from '@playwright/test'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { triggerMenuCommand } from './testBridge'

let tempVaultDir: string

async function holdCompletedAutoRenameResponse(page: Page): Promise<void> {
  await page.evaluate(() => {
    const internals = '__TAURI_INTERNALS__' in window ? window.__TAURI_INTERNALS__ : undefined
    if (typeof internals !== 'object' || internals === null || !('invoke' in internals) || typeof internals.invoke !== 'function') {
      throw new Error('Tauri invoke bridge is missing')
    }

    const originalInvoke = internals.invoke.bind(internals) as (command: string, args?: Record<string, unknown>) => Promise<unknown>
    internals.invoke = async (command: string, args?: Record<string, unknown>) => {
      const result = await originalInvoke(command, args)
      if (command !== 'auto_rename_untitled') return result

      document.documentElement.dataset.autoRenameResponseHeld = 'true'
      await new Promise<void>((resolve) => {
        document.addEventListener('tolaria:test:release-auto-rename', () => resolve(), { once: true })
      })
      return result
    }
  })
}

async function waitForCompletedAutoRename(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.autoRenameResponseHeld === 'true')
}

async function releaseCompletedAutoRenameResponse(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.dispatchEvent(new Event('tolaria:test:release-auto-rename'))
  })
}

async function openPropertiesPanel(page: Page): Promise<void> {
  const openPanelButton = page.getByRole('button', { name: 'Open the properties panel' })
  if (await openPanelButton.count()) await openPanelButton.click()
}

// The list is virtualized and the new page sorts last, so filter it first as a user would.
async function openNoteFromList(page: Page, title: string): Promise<void> {
  const search = page.getByPlaceholder('Search notes...')
  if (!(await search.isVisible())) {
    await page.getByTitle('Search notes').click()
    await expect(search).toBeVisible()
  }
  await search.fill(title)
  await expect(page.getByTestId('note-list-search-loading')).toHaveCount(0, { timeout: 5_000 })
  await page.locator('[data-testid="note-list-container"]').getByText(title, { exact: true }).click()
}

test.beforeEach(async ({ page }, testInfo) => {
  testInfo.setTimeout(60_000)
  tempVaultDir = createFixtureVaultCopy()
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
})

test.afterEach(() => {
  removeFixtureVaultCopy(tempVaultDir)
})

test('@smoke the first type change keeps a newly titled note active and persists', async ({ page }) => {
  const title = `First Property ${Date.now()}`

  await holdCompletedAutoRenameResponse(page)
  await triggerMenuCommand(page, 'file-new-note')
  // New pages start as one blank body block; the title is the user's own `# ` heading.
  const firstBlock = page.locator('.bn-editor .bn-block-content').first()
  await expect(firstBlock).toHaveAttribute('data-content-type', 'paragraph', { timeout: 5_000 })
  await firstBlock.click()
  await page.keyboard.type('# ')
  await expect(page.locator('.bn-block-content[data-content-type="heading"]').first()).toBeVisible()
  await page.keyboard.type(title)
  await waitForCompletedAutoRename(page)

  await openPropertiesPanel(page)
  const typeSelector = page.getByTestId('type-selector')
  // An ordinary new page has no properties, so no type, until the user adds them.
  await expect(page.getByText('This note has no properties yet')).toBeVisible()
  await expect(typeSelector).toHaveCount(0)
  // The page's first property change (it sets type Note) is made while the rename reply is held.
  await page.getByRole('button', { name: 'Initialize properties' }).click()
  await releaseCompletedAutoRenameResponse(page)

  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
  await expect(typeSelector.getByRole('combobox')).toContainText('Note')
  await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText('first-property-', {
    timeout: 10_000,
  })
  await typeSelector.getByRole('combobox').click()
  await page.getByRole('option', { name: 'Project', exact: true }).click()
  await expect(page.getByRole('heading', { name: title, level: 1 })).toBeVisible()
  await expect(typeSelector.getByRole('combobox')).toContainText('Project')

  await openNoteFromList(page, 'Alpha Project')
  await openNoteFromList(page, title)
  await expect(page.getByTestId('type-selector').getByRole('combobox')).toContainText('Project')
})
