import fs from 'fs'
import path from 'path'
import { test, expect, type Page } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

// Disposable pages typed with the canonical `type:` key. No title contains its type,
// so only a correctly parsed type can make a badge pass.
const SEEDED_TYPED_PAGES = [
  { file: 'weekly-review.md', title: 'Weekly Review', type: 'Procedure' },
  { file: 'grow-newsletter.md', title: 'Grow Newsletter', type: 'Responsibility' },
  { file: 'laputa-launch.md', title: 'Laputa Launch', type: 'Project' },
]

let tempVaultDir: string

function seedTypedPages(vaultPath: string): void {
  for (const { file, title, type } of SEEDED_TYPED_PAGES) {
    fs.writeFileSync(path.join(vaultPath, file), `---\ntype: ${type}\n---\n# ${title}\n\nSynthetic page for type parsing.\n`)
  }
}

// The finder shows titles only; the pane's "Choose a page" picker keeps the type badge.
async function openPagePicker(page: Page): Promise<void> {
  await page.locator('.ll-pane').first().getByRole('button', { name: 'Choose a page' }).click()
  await expect(page.getByTestId('quick-open-palette').getByRole('textbox')).toBeVisible()
}

/** The badge on the one row whose title is exactly `title` reads exactly `type`. */
async function expectTypeBadge(page: Page, query: string, title: string, type: string): Promise<void> {
  const picker = page.getByTestId('quick-open-palette')
  await picker.getByRole('textbox').fill(query)
  const row = picker.getByRole('button').filter({ has: page.getByText(title, { exact: true }) })
  await expect(row).toHaveCount(1)
  await expect(row.locator('[data-slot="badge"]')).toHaveText(type)
}

test.describe('Frontmatter parsing: type badge displays correctly', () => {
  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    seedTypedPages(tempVaultDir)
    await openFixtureVault(page, tempVaultDir)
    await openPagePicker(page)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('procedure note shows type badge in Quick Open', async ({ page }) => {
    await expectTypeBadge(page, 'Weekly', 'Weekly Review', 'Procedure')
  })

  test('responsibility note shows type badge in Quick Open', async ({ page }) => {
    await expectTypeBadge(page, 'Newsletter', 'Grow Newsletter', 'Responsibility')
  })

  test('project note shows type badge in Quick Open', async ({ page }) => {
    await expectTypeBadge(page, 'Laputa', 'Laputa Launch', 'Project')
  })

  test('legacy "Is A:" key shows its type badge in Quick Open', async ({ page }) => {
    // Unmodified shared fixture page: `Is A: Event`, title "Team Meeting".
    await expectTypeBadge(page, 'Team', 'Team Meeting', 'Event')
  })
})

test.describe('Frontmatter parsing: sidebar', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('sidebar shows type sections', async ({ page }) => {
    // Sidebar sections are rendered as nav items — look for them in the page
    await expect(page.locator('text=Projects').first()).toBeVisible({ timeout: 3000 })
    await expect(page.locator('text=Responsibilities').first()).toBeVisible({ timeout: 3000 })
  })
})
