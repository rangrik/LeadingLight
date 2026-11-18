import { findPage } from "./navigation";
import { expect, type Page, test } from "@playwright/test";

const panes = (page: Page) => page.locator('[data-pane]');
const mode = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });
const toggle = (page: Page) => page.getByRole('button', { name: /^(Hide sidebar|Toggle Sidebar)$/ });
async function setup(page: Page) {
  await page.addInitScript(() => localStorage.setItem('ll.browser.standin', '1'));
  await page.route('**/__runtime/**', (route) => route.fulfill({ json: [] }));
  await page.goto('/');
  await page.getByRole('button', { name: 'New page', exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Kyoto research');
  await page.getByRole('textbox', { name: 'Page body', exact: true }).fill('Compare the walking route with our hotel.');
}
async function newBrowser(page: Page, url: string) {
  await mode(page, 'Browser').click();
  await page.getByRole('button', { name: /Search or enter address/ }).click();
  await page.getByRole('combobox', { name: 'Search or enter address' }).fill(url);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('standin-page')).toHaveAttribute('data-live', 'true');
}
async function split(page: Page) {
  await newBrowser(page, 'https://kyoto.example/Walking-guide');
  await mode(page, 'Notes').click();
  await (await findPage(page, 'Kyoto research')).click({ modifiers: ['Shift'] });
  await expect(panes(page)).toHaveCount(2);
}

// Seam: sidebar mode versus pane state. Switching modes must preserve mounted editors and native bounds.
test('modes preserve a mixed split and provide just one sidebar toggle', async ({ page }) => {
  await setup(page);
  await expect(page.getByRole('navigation', { name: 'Recent' })).toHaveCount(0);
  await split(page);
  const note = page.getByRole('textbox', { name: 'Page body' });
  await note.press('ControlOrMeta+End');
  await note.pressSequentially(' Keep this edit.');
  await page.keyboard.press('Alt+Meta+b');
  await expect(mode(page, 'Browser')).toBeChecked();
  await expect(note).toContainText('Keep this edit.');
  await expect(panes(page)).toHaveCount(2);
  await expect(toggle(page)).toHaveCount(1);
  await toggle(page).click();
  await expect(page.locator('[data-sidebar-modes]')).not.toBeInViewport();
  await expect(toggle(page)).toHaveCount(1);
  await toggle(page).click();
  await mode(page, 'Notes').click();
  await page.waitForTimeout(900);
  await page.reload();
  await expect(panes(page)).toHaveCount(2);
  await expect(note).toContainText('Keep this edit.');
  await expect(mode(page, 'Notes')).toBeChecked();
  await expect(page.getByTestId('standin-page')).toHaveAttribute('data-live', 'true');
  await page.screenshot({ path: 'qa/report/sidebar-modes-split.png' });
});

// Seam: explicit split navigation and keyboard routing across a native browser and a note.
test('Open beside is discoverable and subsequent selections keep the other pane', async ({ page }) => {
  test.setTimeout(60_000);
  await setup(page);
  await newBrowser(page, 'https://kyoto.example/Walking-guide');
  await page.getByRole('button', { name: 'New tab', exact: true }).click();
  await page.getByRole('combobox', { name: 'Search or enter address' }).fill('https://kyoto.example/Train-times');
  await page.keyboard.press('Enter');
  await mode(page, 'Notes').click();
  await (await findPage(page, 'Kyoto research')).click();
  await mode(page, 'Browser').click();
  await page.getByRole('button', { name: 'More for Walking-guide' }).click();
  await page.getByRole('menuitem', { name: 'Open beside' }).click();
  await expect(panes(page)).toHaveCount(2);
  await page.getByRole('list', { name: 'Tabs', exact: true }).getByRole('button', { name: 'Train-times', exact: true }).click();
  await expect(page.getByTestId('standin-page')).toContainText('Train-times');
  await expect(page.getByRole('textbox', { name: 'Title', exact: true })).toHaveValue('Kyoto research');
  await mode(page, 'Notes').click();
  await page.getByRole('button', { name: 'New page', exact: true }).click();
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

// Seam: gesture recognition and modal isolation. Vertical and diagonal scroll must not switch modes.
test('gestures are directional, latched and available in the narrow sidebar sheet', async ({ page }) => {
  await setup(page);
  const sidebar = page.locator('[data-sidebar-modes]');
  await sidebar.dispatchEvent('wheel', { deltaX: 30, deltaY: 40 });
  await sidebar.dispatchEvent('wheel', { deltaX: 80, deltaY: 0, ctrlKey: true });
  await expect(mode(page, 'Notes')).toBeChecked();
  await sidebar.dispatchEvent('wheel', { deltaX: 80, deltaY: 0 });
  await expect(mode(page, 'Browser')).toBeChecked();
  await sidebar.dispatchEvent('wheel', { deltaX: -100, deltaY: 0 });
  await expect(mode(page, 'Browser')).toBeChecked();
  await page.waitForTimeout(300);
  await sidebar.dispatchEvent('wheel', { deltaX: -80, deltaY: 0 });
  await expect(mode(page, 'Notes')).toBeChecked();
  await page.getByRole('button', { name: 'Search library', exact: true }).click();
  await page.keyboard.press('Alt+Meta+b');
  await expect(page.getByRole('dialog', { name: 'Search library' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(mode(page, 'Notes')).toBeChecked();
  await page.setViewportSize({ width: 700, height: 800 });
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await sidebar.dispatchEvent('wheel', { deltaX: 80, deltaY: 0 });
  await expect(mode(page, 'Browser')).toBeChecked();
});

// Seam: the all-page Library and pins against persisted real note metadata.
test('Library finds, pins and opens notes without a Recents list', async ({ page }) => {
  await setup(page);
  await page.getByRole('button', { name: 'Search library', exact: true }).click();
  const library = page.getByRole('dialog', { name: 'Search library' });
  await library.getByRole('combobox').fill('missing');
  await expect(library.getByText('No matches. Try a page title, words from a page, or a type.')).toBeVisible();
  await library.getByRole('combobox').fill('Kyoto');
  await library.getByRole('button', { name: 'Pin', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('navigation', { name: 'Pinned', exact: true }).getByRole('button', { name: 'Kyoto research', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Pinned', exact: true }).getByRole('button', { name: 'Kyoto research', exact: true })).toBeVisible();
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
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/' + 'native-browser.ts')).standinShown.get())).toBe('');
  await page.getByRole('tab', { name: /^Browser Close tab$/ }).click();
  await expect(page.getByTestId('standin-page')).toHaveAttribute('data-live', 'true');
  await page.getByRole('region', { name: 'Browser', exact: true }).getByRole('button', { name: 'Close page', exact: true }).click();
  await expect(page.getByTestId('browser-space')).toHaveCount(0);
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/' + 'native-browser.ts')).standinShown.get())).toBe('');
});
