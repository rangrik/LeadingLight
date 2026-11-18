import { expect, type Page, test } from '@playwright/test';
import type { ObjectStore } from '../src/lib/store';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Search library', exact: true });
const input = (page: Page) => dialog(page).getByRole('combobox');
const title = (page: Page) => page.getByRole('textbox', { name: 'Title', exact: true });
async function search(page: Page, query = '') {
  if (!await dialog(page).isVisible()) await page.keyboard.press('Meta+k');
  await expect(input(page)).toBeFocused();
  await input(page).fill(query);
}
async function start(page: Page) {
  await page.addInitScript(() => localStorage.setItem('ll.browser.standin', '1'));
  await page.route('**/__runtime/**', r => r.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Search library', exact: true })).toBeEnabled();
}

// Seam: saved summaries and the new palette. New/edited typed pages must survive search and reload.
test('recent pages, full library, body search and type creation', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const { createPage } = await import('/src/lib/' + 'space.ts');
    for (let n = 0; n < 24; n++) await createPage({ title: `Archive ${n}`, createdAt: 1, updatedAt: 1 });
  });
  await page.getByRole('button', { name: 'Choose page type' }).click();
  await input(page).fill('book');
  await page.keyboard.press('Enter');
  await expect(title(page)).toBeFocused();
  await title(page).fill('The Creative Act');
  await title(page).press('Enter');
  await page.keyboard.type('A quiet studio under the northern lights');
  await page.keyboard.press('Meta+n');
  await expect(title(page)).toHaveValue('');
  await title(page).fill('Friday review');
  await search(page);
  await expect(dialog(page).getByRole('option').first()).toHaveText('Friday reviewPage');
  await expect(dialog(page).getByRole('option', { name: 'The Creative Act', exact: true })).toBeVisible();
  await input(page).fill('northern lights');
  await expect(dialog(page).getByRole('option', { name: 'The Creative Act', exact: true })).toBeVisible();
  await input(page).fill('creative northern');
  await expect(dialog(page).getByRole('option', { name: 'The Creative Act', exact: true })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveValue('The Creative Act');
  await page.reload();
  await search(page, 'book');
  await expect(dialog(page).getByRole('option', { name: 'The Creative Act', exact: true })).toBeVisible();
  await expect(dialog(page).getByRole('option', { name: 'Books', exact: true })).toBeVisible();
  await expect(dialog(page).getByRole('option', { name: 'New book', exact: true })).toBeVisible();
  await input(page).fill('');
  await dialog(page).getByRole('option', { name: 'Browse all pages' }).click();
  await expect(dialog(page).getByRole('option')).toHaveCount(26);
  await input(page).fill('Archive 23');
  await expect(dialog(page).getByRole('option', { name: 'Archive 23', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { space } = await import('/src/lib/' + 'space.ts');
    const { editPage } = await import('/src/lib/' + 'live.ts');
    await editPage(space.get().pages.find((p: { title: string }) => p.title === 'Archive 0').id, { content: () => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'An agent revision' }] }] }) });
  });
  await dialog(page).getByRole('button', { name: 'Back to search' }).click();
  await expect(dialog(page).getByRole('option').first()).toHaveAttribute('aria-label', 'Archive 0');
  await input(page).fill('agent revision');
  await expect(dialog(page).getByRole('option', { name: 'Archive 0', exact: true })).toBeVisible();
  await page.screenshot({ path: 'qa/report/search-library.png' });
});

// Seam: focused pane routing versus independent sidebar mode and native overlay suppression.
test('Cmd N and global search preserve a mixed split', async ({ page }) => {
  await start(page);
  await page.keyboard.press('Meta+n');
  await title(page).fill('Kyoto itinerary');
  await page.getByRole('radio', { name: 'Browser', exact: true }).click();
  await page.getByRole('button', { name: /Search or enter address/ }).click();
  await page.getByRole('combobox', { name: 'Search or enter address' }).fill('https://kyoto.example/Walking-guide');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('standin-page')).toHaveAttribute('data-live', 'true');
  await page.keyboard.press('Meta+l');
  await expect(page.getByRole('combobox', { name: 'Search or enter address' })).toBeVisible();
  await search(page, 'Kyoto itinerary');
  await expect(page.getByRole('combobox', { name: 'Search or enter address' })).not.toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/' + 'native-browser.ts')).standinShown.get())).toBe('');
  await page.keyboard.press('Shift+Enter');
  await expect(page.locator('[data-pane]')).toHaveCount(2);
  await expect(page.getByRole('radio', { name: 'Notes', exact: true })).toBeChecked();
  await page.getByTestId('browser-page').click();
  await page.keyboard.press('Meta+n');
  await page.getByRole('combobox', { name: 'Search or enter address' }).fill('https://kyoto.example/Trains');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('standin-page')).toContainText('Trains');
  await page.getByRole('textbox', { name: 'Page body' }).click();
  await page.getByRole('radio', { name: 'Browser', exact: true }).click();
  await page.keyboard.press('Meta+n');
  await expect(title(page)).toHaveValue('');
  await title(page).fill('Packing');
  await expect(page.getByRole('tab', { name: /^Kyoto itinerary/ })).toBeVisible();
  await expect(page.getByTestId('standin-page')).toContainText('Trains');
  await search(page, 'Walking');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radio', { name: 'Browser', exact: true })).toBeChecked();
  await expect(title(page)).toHaveValue('Packing');
  await expect(page.getByTestId('standin-page')).toContainText('Walking-guide');
  await page.getByRole('button', { name: 'Hide sidebar' }).click();
  await search(page, 'Packing');
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveValue('Packing');
  await expect(page.locator('[data-pane]')).toHaveCount(2);
  await page.screenshot({ path: 'qa/report/search-split.png' });
  await page.setViewportSize({ width: 700, height: 800 });
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await search(page, 'Packing');
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await page.keyboard.press('Escape');
});

// Seam: async search cancellation and failure recovery; the current query must always win.
test('late results, body-search errors and creation errors recover', async ({ page }) => {
  await start(page);
  await page.evaluate(async () => {
    const { createPage, putType, typeOf } = await import('/src/lib/' + 'space.ts');
    const { objects, pageTexts } = await import('/src/lib/' + 'objects.ts');
    await createPage({ title: 'Slow result', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'alpha' }] }] } });
    await createPage({ title: 'Fast result', content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'be', marks: [{ type: 'bold' }] }, { type: 'text', text: 'ta' }] }] } });
    const template = await createPage({ title: 'Recipe template', properties: { templateOf: 'recipe' }, content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ingredients and method' }] }] } });
    await putType({ ...typeOf('page'), id: 'recipe', name: 'Recipe', plural: 'Recipes', template: template.id });
    const read = pageTexts.read;
    let reads = 0;
    pageTexts.read = async (pages: Parameters<typeof read>[0]) => { const n = ++reads; if (n === 1) await new Promise(r => setTimeout(r, 800)); if (n === 3) throw Error('offline fixture'); return read(pages); };
    const create = objects.create;
    let fail = true;
    objects.create = async (...args: Parameters<ObjectStore["create"]>) => { if (fail && args[0]?.typeId === 'recipe') { fail = false; throw Error('disk fixture'); } return create(...args); };
  });
  await search(page, 'alpha');
  await page.waitForTimeout(220);
  await input(page).fill('beta');
  await expect(dialog(page).getByRole('option', { name: 'Fast result', exact: true })).toBeVisible();
  await page.waitForTimeout(900);
  await expect(dialog(page).getByRole('option', { name: 'Slow result', exact: true })).toHaveCount(0);
  await input(page).fill('unavailable');
  await expect(dialog(page).getByText(/Page text could not be searched/)).toBeVisible();
  await input(page).fill('new recipe');
  await page.keyboard.press('Enter');
  await expect(dialog(page).getByText(/Could not create this page/)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).not.toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Page body' })).toContainText('Ingredients and method');
  await search(page);
  const before = await page.evaluate(async () => (await import('/src/lib/' + 'space.ts')).space.get().pages.length);
  await page.keyboard.press('Meta+n');
  expect(await page.evaluate(async () => (await import('/src/lib/' + 'space.ts')).space.get().pages.length)).toBe(before);
  await page.keyboard.press('Meta+k');
  await expect(dialog(page)).not.toBeVisible();
});
