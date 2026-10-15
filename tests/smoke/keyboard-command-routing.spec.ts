import { test, expect, type Page } from '@playwright/test'
import { APP_COMMAND_IDS } from '../../src/hooks/appCommandCatalog'
import { areAiFeaturesEnabled } from '../../src/lib/aiFeatures'
import { RUNTIME_STYLE_NONCE } from '../../src/lib/runtimeStyleNonce'
import {
  dispatchShortcutEvent,
  triggerMenuCommand,
  triggerShortcutCommand,
} from './testBridge'
import {
  createFixtureVaultCopy,
  openFixtureVaultDesktopHarness,
  removeFixtureVaultCopy,
} from '../helpers/fixtureVault'
import { installFixtureVaultDesktopBridgeInBrowser } from '../helpers/fixtureVaultDesktopBridge'

let tempVaultDir: string

// Fork policy decides, not saved settings: even a user who turned AI on gets none in LeadingLight.
const AI_WORKSPACE_ALLOWED = areAiFeaturesEnabled({ ai_features_enabled: true })

// Inbox and organizing are opt-in; this is the vault setting a user turns on.
const ORGANIZING_VAULT_CONFIG = { inbox: { noteListProperties: null, explicitOrganization: true } }

// Page-text hits must be listed pages, so they name real fixture files under the searched vault.
const GLOBAL_SEARCH_RESULTS = [
  { title: 'Team Meeting', file: 'event/team-meeting.md', snippet: 'Weekly sync first', score: 1, note_type: null },
  { title: 'Note C', file: 'note/note-c.md', snippet: 'Weekly sync second', score: 0.9, note_type: null },
  { title: 'Note B', file: 'note/note-b.md', snippet: 'Weekly sync third', score: 0.8, note_type: null },
]

async function openAlphaProjectInEditor(page: Page) {
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
  await page.getByText('Alpha Project', { exact: true }).first().click()
  await page.locator('.bn-editor').click()
}

async function openAlphaProjectWithOrganizing(page: Page) {
  await openFixtureVaultDesktopHarness(page, tempVaultDir)
  // The harness resets storage on every load, so the saved setting goes in a later script and a reload.
  await page.addInitScript(({ key, value }) => { localStorage.setItem(key, value) }, {
    key: `laputa:vault-config:${tempVaultDir}`,
    value: JSON.stringify(ORGANIZING_VAULT_CONFIG),
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByTestId('sidebar-top-nav').getByText('Inbox', { exact: true })).toBeVisible({ timeout: 30_000 })
  await page.waitForFunction(() => typeof window.__laputaTest?.dispatchBrowserMenuCommand === 'function')
  await page.evaluate(installFixtureVaultDesktopBridgeInBrowser)
  await page.waitForFunction(() => Boolean(window.__TAURI_INTERNALS__))
  await page.getByText('Alpha Project', { exact: true }).first().click()
  await page.locator('.bn-editor').click()
}

function collectRuntimeStyleCspSignals(page: Page): string[] {
  const messages: string[] = []

  page.on('pageerror', (error) => {
    messages.push(error.message)
  })

  page.on('console', (message) => {
    const text = message.text()
    if (
      /Content Security Policy|Refused to apply a stylesheet|Failed to insert placeholder CSS rule|style-src|insertRule/i
        .test(text)
    ) {
      messages.push(text)
    }
  })

  return messages
}

async function expectRuntimeStyleNonce(page: Page): Promise<void> {
  await expect.poll(async () => page.evaluate((nonce) => {
    const styles = Array.from(document.querySelectorAll('style')) as HTMLStyleElement[]
    return styles.some((style) => style.nonce === nonce)
  }, RUNTIME_STYLE_NONCE), { timeout: 5_000 }).toBe(true)
}

async function expectPropertiesPanelToggle(page: Page, toggle: () => Promise<void>) {
  const propertiesButton = page.getByRole('button', { name: 'Open the properties panel' })
  await expect(propertiesButton).toBeVisible({ timeout: 5_000 })

  await toggle()
  await expect(propertiesButton).toHaveCount(0)

  await toggle()
  await expect(page.getByRole('button', { name: 'Open the properties panel' })).toBeVisible({ timeout: 5_000 })
}

async function dispatchAppCommand(page: Page, id: string): Promise<void> {
  await page.evaluate((commandId) => {
    const bridge = window.__laputaTest?.dispatchAppCommand
    if (typeof bridge !== 'function') {
      throw new Error('Tolaria test bridge is missing dispatchAppCommand')
    }
    bridge(commandId)
  }, id)
}

async function openQuickOpenFromKeyboard(page: Page): Promise<void> {
  await dispatchShortcutEvent(page, {
    key: 'p',
    code: 'KeyP',
    ctrlKey: false,
    metaKey: true,
    shiftKey: false,
    altKey: false,
    bubbles: true,
    cancelable: true,
  })
  await expect(finder(page)).toBeVisible({ timeout: 5_000 })
}

function finder(page: Page) {
  return page.getByRole('dialog', { name: 'Find a page' })
}

function selectedQuickOpenTitle(page: Page) {
  return finder(page).locator('[role="option"][aria-selected="true"] span.truncate').first()
}

function quickOpenTitleAt(page: Page, index: number) {
  return finder(page).locator('[role="option"] span.truncate').nth(index)
}

async function installGlobalSearchResultsHarness(page: Page): Promise<void> {
  await page.waitForFunction(() => Boolean(window.__mockHandlers?.search_vault))
  await page.evaluate((results) => {
    type Handler = (args?: Record<string, unknown>) => unknown
    const handlers = window.__mockHandlers as Record<string, Handler>
    Object.defineProperty(window, '__mockHandlers', {
      configurable: true,
      get: () => handlers,
      set: (nextHandlers) => Object.assign(handlers, nextHandlers),
    })
    handlers.search_vault = (args) => {
      const root = String(args?.vaultPath ?? '').replace(/\/+$/, '')
      return {
        results: results.map(({ file, ...result }) => ({ ...result, path: `${root}/${file}` })),
        elapsed_ms: 1,
      }
    }
  }, GLOBAL_SEARCH_RESULTS)
}

function searchResultRow(page: Page, title: string) {
  return finder(page).locator('[role="option"]').filter({ hasText: title }).first()
}

async function expectSelectedSearchResult(page: Page, title: string): Promise<void> {
  await expect(searchResultRow(page, title)).toHaveAttribute('aria-selected', 'true')
}

test.describe('keyboard command routing', () => {
  test.beforeEach(() => {
    tempVaultDir = createFixtureVaultCopy()
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('desktop menu-command bridge creates a note through the shared command path @smoke', async ({ page }) => {
    const runtimeStyleCspSignals = collectRuntimeStyleCspSignals(page)

    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await triggerMenuCommand(page, APP_COMMAND_IDS.fileNewNote)

    await expect(page.getByTestId('breadcrumb-filename-trigger')).toContainText(/untitled-note-\d+/i, { timeout: 5_000 })
    await expectRuntimeStyleNonce(page)
    expect(runtimeStyleCspSignals).toEqual([])
  })

  test('desktop menu-command bridge toggles the properties panel through the shared command path', async ({ page }) => {
    await openAlphaProjectInEditor(page)
    await expectPropertiesPanelToggle(page, async () => {
      await triggerMenuCommand(page, APP_COMMAND_IDS.viewToggleProperties)
    })
  })

  test('desktop keyboard shortcut toggles the properties panel through the renderer shortcut path', async ({ page }) => {
    await openAlphaProjectInEditor(page)
    await expectPropertiesPanelToggle(page, async () => {
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+I' : 'Control+Shift+I')
    })
  })

  test('desktop shortcut bridge opens quick open through both Cmd+P and Cmd+O @smoke', async ({ page }) => {
    await openFixtureVaultDesktopHarness(page, tempVaultDir)

    await openQuickOpenFromKeyboard(page)
    await expect(finder(page).getByRole('combobox')).toBeFocused()

    await page.keyboard.press('Escape')
    await expect(finder(page)).not.toBeVisible({ timeout: 5_000 })

    await dispatchShortcutEvent(page, {
      key: 'o',
      code: 'KeyO',
      ctrlKey: false,
      metaKey: true,
      shiftKey: false,
      altKey: false,
      bubbles: true,
      cancelable: true,
    })
    await expect(finder(page)).toBeVisible({ timeout: 5_000 })
    await expect(finder(page).getByRole('combobox')).toBeFocused()
  })

  test('quick open ignores a stationary pointer until it moves', async ({ page }) => {
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await openQuickOpenFromKeyboard(page)

    const initialTitle = await selectedQuickOpenTitle(page).textContent()
    const secondTitle = quickOpenTitleAt(page, 1)
    const targetTitle = await secondTitle.textContent()
    const secondTitleBox = await secondTitle.boundingBox()
    if (!initialTitle) throw new Error('Quick open did not select an initial note')
    if (!targetTitle) throw new Error('Quick open did not render a second note title')
    if (!secondTitleBox) throw new Error('Quick open did not render a second note box')

    await page.keyboard.press('Escape')
    await expect(finder(page)).not.toBeVisible({ timeout: 5_000 })
    await page.mouse.move(
      secondTitleBox.x + secondTitleBox.width / 2,
      secondTitleBox.y + secondTitleBox.height / 2,
    )

    await openQuickOpenFromKeyboard(page)
    await expect(selectedQuickOpenTitle(page)).toHaveText(initialTitle)
    await page.keyboard.press('ArrowDown')
    await expect(selectedQuickOpenTitle(page)).toHaveText(targetTitle)
  })

  test('global search arrow keys move one result at a time @smoke', async ({ page }) => {
    await openFixtureVaultDesktopHarness(page, tempVaultDir)
    await installGlobalSearchResultsHarness(page)

    await page.locator('body').click()
    await dispatchShortcutEvent(page, {
      key: 'f',
      code: 'KeyF',
      ctrlKey: false,
      metaKey: true,
      shiftKey: true,
      altKey: false,
      bubbles: true,
      cancelable: true,
    })
    // Full-text search opens the one finder; its page-text matches follow title matches.
    const input = finder(page).getByRole('combobox')
    await expect(input).toBeFocused({ timeout: 5_000 })
    await input.fill('weekly sync')
    await expect(searchResultRow(page, 'Note B')).toBeVisible({ timeout: 5_000 })
    await expect(finder(page).getByRole('group', { name: 'In page text' }).getByRole('option')).toHaveCount(3)

    await expectSelectedSearchResult(page, 'Team Meeting')
    await page.keyboard.press('ArrowDown')
    await expectSelectedSearchResult(page, 'Note C')
    await page.waitForTimeout(550)
    await page.keyboard.press('ArrowDown')
    await expectSelectedSearchResult(page, 'Note B')
    await page.waitForTimeout(550)
    await page.keyboard.press('ArrowUp')
    await expectSelectedSearchResult(page, 'Note C')
  })

  test('desktop menu-command bridge toggles organized state through the shared command path', async ({ page }) => {
    await openAlphaProjectWithOrganizing(page)

    await expect(page.getByRole('button', { name: 'Set note as organized' })).toBeVisible({ timeout: 5_000 })

    await triggerMenuCommand(page, APP_COMMAND_IDS.noteToggleOrganized)
    await expect(page.getByRole('button', { name: 'Set note as not organized' })).toBeVisible({ timeout: 5_000 })

    await triggerMenuCommand(page, APP_COMMAND_IDS.noteToggleOrganized)
    await expect(page.getByRole('button', { name: 'Set note as organized' })).toBeVisible({ timeout: 5_000 })
  })

  test('app command bridge undoes and redoes organized state through action history', async ({ page }) => {
    await openAlphaProjectWithOrganizing(page)
    // Inside the editor, undo belongs to the text; app action history is undone from outside it.
    await page.getByTestId('note-list-container').focus()
    await expect(page.getByTestId('note-list-container')).toBeFocused()

    await triggerMenuCommand(page, APP_COMMAND_IDS.noteToggleOrganized)
    await expect(page.getByRole('button', { name: 'Set note as not organized' })).toBeVisible({ timeout: 5_000 })

    await dispatchAppCommand(page, APP_COMMAND_IDS.editUndo)
    await expect(page.getByRole('button', { name: 'Set note as organized' })).toBeVisible({ timeout: 5_000 })

    await dispatchAppCommand(page, APP_COMMAND_IDS.editRedo)
    await expect(page.getByRole('button', { name: 'Set note as not organized' })).toBeVisible({ timeout: 5_000 })
  })

  test('renderer accepts a layout-produced backslash for the raw editor shortcut', async ({ page }) => {
    const runtimeStyleCspSignals = collectRuntimeStyleCspSignals(page)

    await openAlphaProjectInEditor(page)

    await dispatchShortcutEvent(page, {
      key: '\\',
      code: 'Digit7',
      ctrlKey: false,
      metaKey: true,
      shiftKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    await expect(page.getByTestId('raw-editor-codemirror')).toBeVisible({ timeout: 5_000 })
    await expectRuntimeStyleNonce(page)

    await triggerShortcutCommand(page, APP_COMMAND_IDS.editToggleRawEditor)
    await expect(page.getByTestId('raw-editor-codemirror')).not.toBeVisible({ timeout: 5_000 })
    await expect(page.locator('.bn-editor')).toBeVisible({ timeout: 5_000 })
    expect(runtimeStyleCspSignals).toEqual([])
  })

  test('desktop menu-command bridge toggles the AI panel, while the wrong modifier event does not', async ({ page }) => {
    test.skip(!AI_WORKSPACE_ALLOWED, 'LeadingLight policy disables remote AI; the next test proves it stays unavailable')
    await openAlphaProjectInEditor(page)

    await dispatchShortcutEvent(page, {
      key: 'l',
      code: 'KeyL',
      ctrlKey: false,
      metaKey: false,
      shiftKey: true,
      altKey: true,
      bubbles: true,
      cancelable: true,
    })
    await page.waitForTimeout(200)
    await expect(page.getByTestId('ai-panel')).not.toBeVisible()

    await triggerMenuCommand(page, APP_COMMAND_IDS.viewToggleAiChat)
    await expect(page.getByTestId('ai-panel')).toBeVisible({ timeout: 5_000 })
    await expect(page.getByTitle('Close AI workspace')).toBeVisible()

    await triggerMenuCommand(page, APP_COMMAND_IDS.viewToggleAiChat)
    await expect(page.getByTestId('ai-panel')).not.toBeVisible({ timeout: 5_000 })
  })

  test('LeadingLight never shows the AI workspace from its shortcut, a wrong modifier or the menu command', async ({ page }) => {
    test.skip(AI_WORKSPACE_ALLOWED, 'Only meaningful while fork policy disables remote AI')
    await openAlphaProjectInEditor(page)

    const aiShortcut = { key: 'l', code: 'KeyL', ctrlKey: false, shiftKey: true, bubbles: true, cancelable: true }
    await dispatchShortcutEvent(page, { ...aiShortcut, metaKey: false, altKey: true })
    await dispatchShortcutEvent(page, { ...aiShortcut, metaKey: true, altKey: false })
    await triggerMenuCommand(page, APP_COMMAND_IDS.viewToggleAiChat)

    // Commands run in order: once a later command visibly works, the AI ones were handled already.
    await expectPropertiesPanelToggle(page, async () => {
      await triggerMenuCommand(page, APP_COMMAND_IDS.viewToggleProperties)
    })
    await expect(page.getByTestId('ai-panel')).toHaveCount(0)
    await expect(page.getByTitle('Close AI workspace')).toHaveCount(0)
  })
})
