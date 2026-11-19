import { findPage, findPinnedPage } from "./navigation";
import { expect, type Page, test } from "@playwright/test";

const panes = (page: Page) => page.locator('[data-pane]');
const sidebar = (page: Page) => page.locator('[data-slot="sidebar-content"]');
const pinned = (page: Page) => page.getByRole('navigation', { name: 'Pinned', exact: true });
const tabs = (page: Page) => page.getByRole('list', { name: 'Tabs', exact: true });
const bar = (page: Page) => page.getByRole('combobox', { name: 'Search or enter address' });
const toggle = (page: Page) => page.getByRole('button', { name: /^(Hide sidebar|Toggle Sidebar)$/ });
async function setup(page: Page) {
  // An older version's saved mode must not hide either list.
  await page.addInitScript(() => {
    localStorage.setItem('ll.browser.standin', '1');
    if (!localStorage.getItem('ll.browser.space')) localStorage.setItem('ll.browser.space', '{"front":true}');
  });
  await page.route('**/__runtime/**', (route) => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.getByRole('button', { name: 'New page', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Kyoto research');
  await page.getByRole('textbox', { name: 'Page body', exact: true }).fill('Compare the walking route with our hotel.');
}
async function newBrowser(page: Page, url: string) {
  await sidebar(page).getByRole('button', { name: 'New tab', exact: true }).click();
  await bar(page).fill(url);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('standin-page')).toHaveAttribute('data-live', 'true');
}
async function split(page: Page) {
  await newBrowser(page, 'https://kyoto.example/Walking-guide');
  await (await findPage(page, 'Kyoto research')).click({ modifiers: ['Shift'] });
  await expect(panes(page)).toHaveCount(2);
}

// Seam: one sidebar list versus pane state. Picking a tab or a note must leave the other list,
// the mounted editor and the split alone, through a hidden sidebar and a restart.
test('notes and tabs share one list, a mixed split and one sidebar toggle', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('radio', { name: 'Browser', exact: true })).toHaveCount(0);
  await expect(tabs(page)).toHaveCount(0);
  await split(page);
  const note = page.getByRole('textbox', { name: 'Page body' });
  await note.press('ControlOrMeta+End');
  await note.pressSequentially(' Keep this edit.');
  const row = await findPinnedPage(page, 'Kyoto research');
  await tabs(page).getByRole('button', { name: 'Walking-guide', exact: true }).click();
  await expect(row).toBeVisible();
  await row.click();
  await expect(tabs(page).getByRole('button', { name: 'Walking-guide', exact: true })).toBeVisible();
  await expect(note).toContainText('Keep this edit.');
  await expect(panes(page)).toHaveCount(2);
  await expect(toggle(page)).toHaveCount(1);
  await toggle(page).click();
  await expect(pinned(page)).not.toBeInViewport();
  await expect(toggle(page)).toHaveCount(1);
  await toggle(page).click();
  await page.waitForTimeout(900);
  await page.reload();
  await expect(panes(page)).toHaveCount(2);
  await expect(note).toContainText('Keep this edit.');
  await expect(row).toBeVisible();
  await expect(tabs(page).getByRole('button', { name: 'Walking-guide', exact: true })).toBeVisible();
  await expect(page.getByTestId('standin-page')).toHaveAttribute('data-live', 'true');
  await page.screenshot({ path: 'qa/report/sidebar-split.png' });
});

// Seam: explicit split navigation and keyboard routing across a native browser and a note.
test('Open beside is discoverable and subsequent selections keep the other pane', async ({ page }) => {
  await setup(page);
  await newBrowser(page, 'https://kyoto.example/Walking-guide');
  await newBrowser(page, 'https://kyoto.example/Train-times');
  await (await findPage(page, 'Kyoto research')).click();
  await page.getByRole('button', { name: 'More for Walking-guide' }).click();
  await page.getByRole('menuitem', { name: 'Open beside' }).click();
  await expect(panes(page)).toHaveCount(2);
  await tabs(page).getByRole('button', { name: 'Train-times', exact: true }).click();
  await expect(page.getByTestId('standin-page')).toContainText('Train-times');
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Kyoto research');
  await page.getByRole('textbox', { name: 'Page body' }).click();
  await page.getByRole('button', { name: 'New page', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('');
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Packing list');
  await expect(panes(page)).toHaveCount(2);
  await expect(page.getByTestId('standin-page')).toBeVisible();
  await page.getByRole('textbox', { name: 'Page body' }).click();
  await page.keyboard.press('ControlOrMeta+w');
  await expect(panes(page)).toHaveCount(2);
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Kyoto research');
  await page.keyboard.press('ControlOrMeta+w');
  await expect(panes(page)).toHaveCount(1);
  await expect(page.getByTestId('standin-page')).toContainText('Train-times');
});

// Seam: ⌥⌘B against pane focus and dialogs. It must hand the keyboard to the browser, open the
// command bar when there is no tab, and never act behind a dialog.
test('Option Command B opens the browser, and does nothing behind a dialog', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('Alt+Meta+b');
  await bar(page).fill('https://kyoto.example/Walking-guide');
  await page.keyboard.press('Enter');
  await (await findPage(page, 'Kyoto research')).click({ modifiers: ['Shift'] });
  await expect(panes(page)).toHaveCount(2);
  await page.getByRole('textbox', { name: 'Page body' }).click();
  await page.getByRole('button', { name: 'Search library', exact: true }).click();
  await page.keyboard.press('Alt+Meta+b');
  await expect(page.getByRole('dialog', { name: 'Search library' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+l');
  await expect(bar(page)).toBeHidden();
  await page.keyboard.press('Alt+Meta+b');
  await expect(page.getByRole('textbox', { name: 'Page body' })).toContainText('Compare the walking route');
  await page.keyboard.press('Meta+l');
  await expect(bar(page)).toHaveValue('https://kyoto.example/Walking-guide');
});

// Seam: the browser's pins and lists inside the notes sidebar. A pinned site must join Pinned, and
// Saved and History, now icons, must still say what they are, in the narrow sheet too.
test('a pinned site joins Pinned, and Saved and History are named icons', async ({ page }) => {
  await setup(page);
  await newBrowser(page, 'https://kyoto.example/Walking-guide');
  await page.getByRole('button', { name: 'More for Walking-guide' }).click();
  await page.getByRole('menuitem', { name: 'Pin', exact: true }).click();
  const tile = pinned(page).getByRole('list', { name: 'Pinned sites' }).getByRole('button', { name: 'Walking-guide', exact: true });
  await expect(tile).toHaveAttribute('aria-current', 'page');
  await expect(tabs(page)).toHaveCount(0);
  for (const name of ['Saved', 'History']) {
    await sidebar(page).getByRole('button', { name, exact: true }).hover();
    await expect(page.locator('[data-slot="tooltip-popup"]')).toHaveText(name);
  }
  const saved = sidebar(page).getByRole('button', { name: 'Saved', exact: true });
  await saved.click();
  await expect(saved).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('heading', { name: 'Saved', exact: true })).toBeVisible();
  await page.screenshot({ path: 'qa/report/sidebar-saved.png' });
  await saved.click();
  await expect(page.getByTestId('standin-page')).toContainText('Walking-guide');
  await page.setViewportSize({ width: 700, height: 800 });
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await expect(tile).toBeVisible();
  await sidebar(page).getByRole('button', { name: 'New tab', exact: true }).click();
  await expect(bar(page)).toBeVisible();
  await expect(tile).toBeHidden();
});

// Seam: the all-page Library and pins against persisted real note metadata.
test('Library finds, pins and opens notes without a Recents list', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('navigation', { name: 'Recent' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Search library', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Search library' });
  await library.getByRole('combobox').fill('missing');
  await expect(library.getByRole('option', { name: 'New page “missing”', exact: true })).toBeVisible();
  await library.getByRole('combobox').fill('Kyoto');
  await library.getByRole('button', { name: 'Pin', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(pinned(page).getByRole('button', { name: 'Kyoto research', exact: true })).toBeVisible();
  await page.reload();
  await expect(pinned(page).getByRole('button', { name: 'Kyoto research', exact: true })).toBeVisible();
});

// Seam: native overlay coordinates follow pane movement even when its size does not change.
test('the browser moves with its pane and hides behind an inactive pane tab', async ({ page }) => {
  await setup(page);
  await split(page);
  const browser = page.getByTestId('browser-page');
  const note = page.getByRole('region', { name: 'Kyoto research', exact: true });
  const from = (await note.getByRole('navigation', { name: 'breadcrumb' }).boundingBox())!;
  const to = (await browser.boundingBox())!;
  await page.mouse.move(from.x + 30, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 8, to.y + to.height / 2, { steps: 15 });
  await page.mouse.up();
  await expect.poll(async () => (await browser.boundingBox())!.x > (await note.boundingBox())!.x).toBe(true);
  await expect.poll(() => page.evaluate(async () => {
    const { standinBounds } = await import('/src/lib/' + 'native-browser.ts');
    const box = document.querySelector('[data-testid=browser-page]')!.getBoundingClientRect();
    const native = standinBounds.get();
    return !!native && Math.abs(native.x - box.x) < 1 && Math.abs(native.y - box.y) < 1 && Math.abs(native.w - box.width) < 1;
  })).toBe(true);
  await browser.click();
  await page.getByRole('button', { name: 'Search library', exact: true }).click();
  await page.getByRole('dialog', { name: 'Search library' }).getByRole('combobox').fill('books');
  await page.getByRole('option', { name: 'Books', exact: true }).click({ modifiers: ['Meta'] });
  await expect(page.getByTestId('browser-space')).toBeHidden();
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/' + 'native-browser.ts')).standinShown.get())).toEqual([]);
  await page.getByRole('tab', { name: /^Walking-guide Close tab$/ }).click();
  await expect(page.getByTestId('standin-page')).toHaveAttribute('data-live', 'true');
  await page.getByRole('region', { name: 'Browser', exact: true }).getByRole('button', { name: 'Close page', exact: true }).click();
  await expect(page.getByTestId('browser-space')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/' + 'native-browser.ts')).standinShown.get())).toEqual([]);
});
