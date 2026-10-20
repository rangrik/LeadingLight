import fs from 'node:fs'
import path from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { parse } from 'yaml'
import { createFixtureVaultCopy, openFixtureVaultDesktopHarness, removeFixtureVaultCopy } from '../helpers/fixtureVault'

/** The native command's arguments, as the desktop bridge passes them under `args`. */
interface FolderMoveRequest {
  vaultPath: string
  oldPath: string
  folderPath: string
  openPaths?: string[]
}

let tempVaultDir: string
let moves: FolderMoveRequest[] = []

const noteBPath = (folder = 'note') => path.join(tempVaultDir, folder, 'note-b.md')
const read = (file: string) => fs.readFileSync(file, 'utf8')
// List rows only: an open pane also carries data-note-path.
const noteBRow = (page: Page, folder = 'note') => page.locator(`[role="option"][data-note-path="${noteBPath(folder)}"]`)

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/
// Metadata by meaning, not by the writer's quoting style.
function frontmatter(text: string): Record<string, unknown> {
  const data: unknown = parse(FRONTMATTER.exec(text)?.[1] ?? '')
  return data && typeof data === 'object' ? data as Record<string, unknown> : {}
}
const body = (text: string) => text.replace(FRONTMATTER, '').trim()

async function centre(locator: Locator) {
  const box = await locator.boundingBox()
  if (!box) throw new Error('Retargeting gesture target has no visible bounds')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// The list is virtualized: wheel it until the row renders, then bring the whole row on screen.
async function revealRow(page: Page, row: Locator): Promise<void> {
  const list = page.getByRole('listbox', { name: 'Notes' })
  await row.waitFor({ state: 'attached', timeout: 2_000 }).catch(() => {})
  for (const direction of [-1, 1]) {
    for (let step = 0; step < 12 && await row.count() === 0; step++) {
      await list.hover()
      await page.mouse.wheel(0, direction * 400)
    }
  }
  await row.scrollIntoViewIfNeeded()
  await expect(row).toBeInViewport({ ratio: 1 })
}

// A trusted mouse press, a move past the threshold, then over the destination. The caller releases.
async function dragNoteTo(page: Page, source: Locator, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded()
  await expect(target).toBeInViewport()
  await revealRow(page, source)
  const from = await centre(source)
  const to = await centre(target)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y, { steps: 3 })
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await expect(page.locator('.ll-drag-chip')).toHaveText('Note B')
}

async function selectAllNotes(page: Page): Promise<void> {
  await page.getByTestId('sidebar-top-nav').getByText('All Notes', { exact: true }).click()
  await revealRow(page, noteBRow(page))
}

// The same viewport as local-note-drag.spec.ts; rows are still revealed by scrolling, never assumed.
test.use({ viewport: { width: 1600, height: 1000 } })

test.describe('note-list retargeting', () => {
  test.setTimeout(90_000)

  test.beforeEach(async ({ page }) => {
    // Real path, so paths the app reports compare exactly.
    tempVaultDir = fs.realpathSync(createFixtureVaultCopy())
    moves = []
    // A controlled receipt for the desktop folder mover: the file moves on disk and the reply has
    // the shape the app validates (relocation/relocationContract.ts). It does not qualify the native mover.
    await page.exposeFunction('fixtureMoveNoteToFolder', (request: FolderMoveRequest) => {
      moves.push(request)
      const content = read(request.oldPath)
      const destination = path.join(request.vaultPath, request.folderPath, path.basename(request.oldPath))
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.renameSync(request.oldPath, destination)
      return {
        new_path: destination, updated_files: 0, failed_updates: 0,
        source_before_content: content, source_content: content, updated_open_pages: [], unrefreshed_open_paths: [],
      }
    })
    // Ready on the helper's default title, which the list shows at the top of this vault.
    await openFixtureVaultDesktopHarness(page, tempVaultDir, {
      folders: [{ name: 'project', path: 'project', children: [] }],
    })
    await page.evaluate(() => {
      const handlers = window.__mockHandlers
      const move = Reflect.get(window, 'fixtureMoveNoteToFolder') as ((request: unknown) => Promise<unknown>) | undefined
      if (!handlers || !move) throw new Error('Fixture move handler is unavailable')
      handlers.move_note_to_folder = (args?: unknown) => move((args as { args?: unknown } | undefined)?.args)
    })
    await expect(page.locator('[data-note-drop-folder="project"]')).toBeVisible({ timeout: 5_000 })
    await selectAllNotes(page)
  })

  test.afterEach(() => removeFixtureVaultCopy(tempVaultDir))

  test('assigns a Type and moves into a Folder by pointer, once each, and both persist after reload', async ({ page }) => {
    const typeTarget = page.locator('[data-note-drop-type="Project"]')
    const folderTarget = page.locator('[data-note-drop-folder="project"]')
    // The whole list's count; a virtualized list cannot prove an entry is absent row by row.
    const allNotes = page.getByTestId('sidebar-top-nav').getByRole('button', { name: /^All Notes/ })
    const listed = await allNotes.textContent()
    const original = read(noteBPath())
    expect(frontmatter(original)).not.toHaveProperty('type', 'Project')

    await dragNoteTo(page, noteBRow(page), typeTarget)
    await expect(typeTarget).toHaveAttribute('data-note-drop-state', 'valid')
    await page.mouse.up()
    await expect(typeTarget).not.toHaveAttribute('data-note-drop-state')
    await expect.poll(() => frontmatter(read(noteBPath())).type).toBe('Project')
    expect(body(read(noteBPath()))).toBe(body(original))
    const typed = read(noteBPath())

    // Already a Project: the same Type is not offered, and releasing there changes nothing.
    await dragNoteTo(page, noteBRow(page), typeTarget)
    await expect(typeTarget).not.toHaveAttribute('data-note-drop-state')
    await page.mouse.up()

    await dragNoteTo(page, noteBRow(page), folderTarget)
    await expect(folderTarget).toHaveAttribute('data-note-drop-state', 'valid')
    await page.mouse.up()
    await expect(folderTarget).not.toHaveAttribute('data-note-drop-state')
    await expect.poll(() => moves.length).toBe(1)
    expect(moves[0]).toEqual(expect.objectContaining({ vaultPath: tempVaultDir, oldPath: noteBPath(), folderPath: 'project' }))
    await revealRow(page, noteBRow(page, 'project'))
    expect(fs.existsSync(noteBPath())).toBe(false)
    expect(read(noteBPath('project'))).toBe(typed)
    // Dragging never opened the note it moved.
    await expect(page.locator('.ll-pane[data-note-path$="/note-b.md"]')).toHaveCount(0)

    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByTestId('sidebar-top-nav')).toBeVisible({ timeout: 15_000 })
    await page.getByTestId('sidebar-top-nav').getByText('All Notes', { exact: true }).click()
    await expect(page.getByText('Alpha Project', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    await revealRow(page, noteBRow(page, 'project'))
    await expect(allNotes).toHaveText(listed ?? '')
    await expect(noteBRow(page)).toHaveCount(0)
    expect(frontmatter(read(noteBPath('project'))).type).toBe('Project')
    expect(moves).toHaveLength(1)
  })
})
