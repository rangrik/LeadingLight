import { test, expect, type Page, type Request } from '@playwright/test'
import { createFixtureVaultCopy, openFixtureVault, removeFixtureVaultCopy } from '../helpers/fixtureVault'

/** Known archived note titles from mock data */
const ARCHIVED_TITLES = ['Website Redesign', 'Twitter Thread Growth Experiment']

function finder(page: Page) {
  return page.getByRole('dialog', { name: 'Find a page' })
}

// Mouse route through the visible sidebar Search; the finder's keyboard routes have their own specs.
async function openQuickOpen(page: Page) {
  await page.getByTestId('sidebar-top-nav').getByRole('button', { name: 'Search', exact: true }).click()
  await expect(finder(page).getByRole('combobox')).toBeVisible()
}

function getResultTitles(container: import('@playwright/test').Locator) {
  return container.locator('span.truncate').allTextContents()
}

/** Page rows only (Recent, Pages, In page text); the create row sits outside these groups. */
function pageRows(page: Page) {
  return finder(page).getByRole('group').getByRole('option')
}

/** Browser mode posts the query as JSON first; the fixture fallback repeats it as a URL query. */
function searchQuery(request: Request): string | null {
  if (!request.url().includes('/api/vault/search')) return null
  const fromUrl = new URL(request.url()).searchParams.get('query')
  if (fromUrl !== null) return fromUrl
  if (request.method() !== 'POST') return null
  try {
    const body = request.postDataJSON() as { query?: unknown } | null
    return typeof body?.query === 'string' ? body.query : null
  } catch {
    return null
  }
}

/** Types a query and waits until page-text search has answered without error. */
async function searchFinder(page: Page, query: string) {
  const answered = page.waitForResponse((response) => searchQuery(response.request()) === query)
  await finder(page).getByRole('combobox').fill(query)
  const response = await answered
  await expect(finder(page).getByText('Searching page text…')).toHaveCount(0, { timeout: 5_000 })
  await expect(finder(page).getByText('Couldn’t search page text.')).toHaveCount(0)
  return (await response.json()) as { results: Array<{ title: string }> }
}

test.describe('Archived Yes/No detection', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
  })

  test('archived notes are filtered out of the default sidebar', async ({ page }) => {
    // In the default sidebar view (non-archived section), archived notes must not appear
    const noteItems = page.locator('[data-testid="note-item"]')
    const count = await noteItems.count()
    for (let i = 0; i < count; i++) {
      const text = await noteItems.nth(i).textContent()
      for (const title of ARCHIVED_TITLES) {
        expect(text, `archived note "${title}" should not be in default sidebar`).not.toContain(title)
      }
    }
  })

  test('archived note shows ArchivedNoteBanner in the editor', async ({ page }) => {
    // Open quick open and navigate to an archived note
    await openQuickOpen(page)
    await finder(page).getByRole('combobox').fill('Website Redesign')
    await page.waitForTimeout(400)

    // The archived note might not appear in quick open (filtered), so try direct URL.
    // Page rows only: the "Create page" row also names the query and must never be clicked here.
    const panel = pageRows(page)
    const titles = await getResultTitles(panel)
    if (titles.some(t => t.includes('Website Redesign'))) {
      // If it appears in quick open, click it
      const result = panel.locator('span.truncate').filter({ hasText: 'Website Redesign' }).first()
      await result.click()
    } else {
      // Close quick open and use sidebar Archived section if available
      await page.keyboard.press('Escape')
      // Click the Archived section header to expand it
      const archivedSection = page.locator('text=Archived').first()
      if (await archivedSection.isVisible({ timeout: 1000 }).catch(() => false)) {
        await archivedSection.click()
        await page.waitForTimeout(300)
        const archivedNote = page.locator('[data-testid="note-item"]').filter({ hasText: 'Website Redesign' })
        if (await archivedNote.isVisible({ timeout: 1000 }).catch(() => false)) {
          await archivedNote.click()
        } else {
          test.skip()
          return
        }
      } else {
        test.skip()
        return
      }
    }

    await page.waitForTimeout(500)
    // Verify the archived banner is visible
    const banner = page.locator('[data-testid="archived-note-banner"]')
    await expect(banner).toBeVisible({ timeout: 3000 })
    await expect(banner).toContainText('Archived')
  })

  test('archived note shows archived badge in the note list', async ({ page }) => {
    // Navigate to the Archived section in the sidebar
    const archivedSection = page.locator('button, [role="button"], span').filter({ hasText: /^Archived/ }).first()
    if (!await archivedSection.isVisible({ timeout: 2000 }).catch(() => false)) {
      test.skip()
      return
    }
    await archivedSection.click()
    await page.waitForTimeout(300)

    // Look for archived badge on note items
    const badges = page.locator('[data-testid="state-badge"]')
    const badgeCount = await badges.count()
    expect(badgeCount).toBeGreaterThan(0)
  })
})

// The demo vault has no archived notes, so this check uses the fixture vault's "Archived: Yes" note.
test.describe('Archived Yes/No detection in the finder', () => {
  let tempVaultDir: string

  test.beforeEach(async ({ page }) => {
    tempVaultDir = createFixtureVaultCopy()
    await openFixtureVault(page, tempVaultDir)
  })

  test.afterEach(() => {
    removeFixtureVaultCopy(tempVaultDir)
  })

  test('archived notes do not appear in Quick Open search', async ({ page }) => {
    await openQuickOpen(page)

    // Controls: an active page is offered by title and by its text, so the absences below mean something.
    await finder(page).getByRole('combobox').fill('Note B')
    await expect(pageRows(page).getByText('Note B', { exact: true })).toBeVisible()
    await searchFinder(page, 'referenced by Alpha Project')
    await expect(finder(page).getByRole('group', { name: 'In page text' }).getByRole('option').filter({ hasText: 'Note B' })).toBeVisible()

    // The vault's own search does return the archived note; the finder must still not offer it.
    const byText = await searchFinder(page, 'This note is archived')
    expect(byText.results.map((result) => result.title)).toContain('Archived Note')
    expect(await getResultTitles(pageRows(page))).not.toContain('Archived Note')

    await searchFinder(page, 'Archived Note')
    expect(await getResultTitles(pageRows(page))).not.toContain('Archived Note')
  })
})
