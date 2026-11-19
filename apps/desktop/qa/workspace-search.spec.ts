import { expect, type Page, test } from '@playwright/test';
import type { ObjectStore } from '../src/lib/store';

const dialog = (page: Page) => page.getByRole('dialog', { name: 'Search library', exact: true });
const input = (page: Page) => dialog(page).getByRole('combobox');
const title = (page: Page) => page.getByRole('textbox', { name: 'Title', exact: true });
async function search(page: Page, query = '') {
  if (!await input(page).isVisible()) await page.keyboard.press('Meta+k');
  await expect(input(page)).toBeFocused();
  await input(page).fill(query);
}
async function start(page: Page) {
  await page.addInitScript(() => localStorage.setItem('ll.browser.standin', '1'));
  await page.route('**/__runtime/**', r => r.fulfill({ json: [] }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Search library', exact: true })).toBeEnabled();
}

// Seam: rendering a library must stay bounded without making later pages unreachable.
test('large libraries page through results and search every page', async ({ page }) => {
  test.setTimeout(60_000);
  await start(page);
  await page.evaluate(async () => {
    const { createPage } = await import('/src/lib/' + 'space.ts');
    for (let n = 0; n < 201; n++) await createPage({ title: `Saved ${n}`, createdAt: n + 1, updatedAt: n + 1 });
  });
  await search(page);
  await dialog(page).getByRole('radio', { name: 'Pages' }).click();
  await expect(dialog(page).getByRole('option')).toHaveCount(101);
  await expect(input(page)).toBeFocused();
  await expect(dialog(page).getByRole('option').first()).toHaveAttribute('data-highlighted', '');
  await expect(dialog(page).getByText('Pages · 1–100 of 201')).toBeVisible();
  await dialog(page).getByRole('option', { name: 'Next pages' }).click();
  await expect(dialog(page).getByRole('option')).toHaveCount(102);
  await expect(input(page)).toBeFocused();
  await expect(dialog(page).getByRole('option').first()).toHaveAttribute('data-highlighted', '');
  await dialog(page).getByRole('option', { name: 'Next pages' }).click();
  await expect(dialog(page).getByRole('option', { name: 'Saved 0', exact: true })).toBeVisible();
  await expect(dialog(page).getByRole('option', { name: 'Next pages' })).toHaveCount(0);
  await dialog(page).getByRole('option', { name: 'Previous 100 pages' }).click();
  await expect(dialog(page).getByText('Pages · 101–200 of 201')).toBeVisible();
  await input(page).fill('Saved 200');
  await expect(dialog(page).getByRole('option')).toHaveCount(1);
  await expect(dialog(page).getByRole('option', { name: 'Saved 200', exact: true })).toBeVisible();
  await input(page).fill('Saved');
  await expect(dialog(page).getByText('Pages · 1–100 of 201')).toBeVisible();
});

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
  await expect(dialog(page).getByRole('group', { name: 'Recent pages' }).getByRole('option').first()).toHaveText('Friday reviewPage');
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
  await dialog(page).getByRole('radio', { name: 'Pages' }).click();
  await expect(dialog(page).getByRole('option')).toHaveCount(26);
  await input(page).fill('Archive 23');
  await expect(dialog(page).getByRole('option', { name: 'Archive 23', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const { space } = await import('/src/lib/' + 'space.ts');
    const { editPage } = await import('/src/lib/' + 'live.ts');
    await editPage(space.get().pages.find((p: { title: string }) => p.title === 'Archive 0').id, { content: () => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'An agent revision' }] }] }) });
  });
  await dialog(page).getByRole('radio', { name: 'All', exact: true }).click();
  await expect(input(page)).toHaveValue('Archive 23');
  await input(page).fill('');
  await expect(dialog(page).getByRole('group', { name: 'Recent pages' }).getByRole('option').first()).toHaveAttribute('aria-label', 'Archive 0');
  await input(page).fill('agent revision');
  await expect(dialog(page).getByRole('option', { name: 'Archive 0', exact: true })).toBeVisible();
  await page.screenshot({ path: 'qa/report/search-library.png' });
  await input(page).fill('new daily');
  await page.keyboard.press('Enter');
  const body = page.getByRole('textbox', { name: 'Page body' });
  await expect(body).toBeFocused();
  await page.keyboard.type('Plan for today');
  await search(page, 'new daily');
  await page.keyboard.press('Enter');
  await expect(body).toBeFocused();
  await expect(body).toContainText('Plan for today');
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
  await search(page, 'Kyoto');
  const category = (name: string) => dialog(page).getByRole('radio', { name, exact: true });
  await category('Pages').click();
  await expect(input(page)).toHaveValue('Kyoto');
  await expect(dialog(page).getByRole('option')).toHaveCount(1);
  await expect(dialog(page).getByRole('option', { name: 'Kyoto itinerary' })).toBeVisible();
  await page.keyboard.press('Meta+5');
  await expect(category('Tabs')).toBeChecked();
  await expect(dialog(page).getByRole('option')).toHaveCount(1);
  await expect(dialog(page).getByText(/Walking-guide/).first()).toBeVisible();
  await category('All').click();
  await expect(dialog(page).getByRole('option')).toHaveCount(2);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Meta+l');
  await expect(page.getByRole('combobox', { name: 'Search or enter address' })).toBeVisible();
  await search(page, 'Kyoto itinerary');
  await expect(page.getByRole('combobox', { name: 'Search or enter address' })).not.toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await import('/src/lib/' + 'native-browser.ts')).standinShown.get())).toEqual([]);
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
  await expect(page.getByTestId('browser-space')).not.toBeVisible();
  await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await search(page, 'Packing');
  await expect(page.locator('[role="dialog"][data-sidebar="sidebar"]')).not.toBeVisible();
  await expect(dialog(page)).toBeVisible();
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
    await putType({ ...typeOf('page'), id: 'recipe', name: 'Family recipe', plural: 'Family recipes', template: template.id });
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
  await page.keyboard.press('Meta+2');
  await input(page).fill('');
  await expect(dialog(page).getByRole('gridcell', { name: 'Family recipe', exact: true })).toBeVisible();
  await input(page).fill('new family recipe Pantry soup');
  await page.keyboard.press('Enter');
  await expect(dialog(page).getByText(/Could not create this page/)).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(dialog(page)).not.toBeVisible();
  await expect(title(page)).toHaveValue('Pantry soup');
  await expect(page.getByRole('textbox', { name: 'Page body' })).toContainText('Ingredients and method');
  await search(page);
  const before = await page.evaluate(async () => (await import('/src/lib/' + 'space.ts')).space.get().pages.length);
  await page.keyboard.press('Meta+n');
  expect(await page.evaluate(async () => (await import('/src/lib/' + 'space.ts')).space.get().pages.length)).toBe(before);
  await page.keyboard.press('Meta+k');
  await expect(dialog(page)).not.toBeVisible();
});

// Seam: a shortcut-opened dialog has no trigger; closing it must restore the writing cursor.
test('search restores the editor and focuses a chosen note', async ({ page }) => {
  test.setTimeout(45_000);
  await start(page);
  await page.keyboard.press('Meta+n');
  await title(page).fill('Resume writing');
  await title(page).press('Enter');
  const body = page.getByRole('textbox', { name: 'Page body', exact: true });
  await page.keyboard.type('Before');
  await search(page, 'no match');
  await page.keyboard.press('Escape');
  await expect(body).toBeFocused();
  await page.keyboard.type(' after');
  await expect(body).toHaveText('Before after');
  await body.click();
  for (let i = 0; i < 'Before after'.length; i++) await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__editor').state.selection.from)).toBe(2);
  await page.keyboard.press('Meta+k');
  await expect(dialog(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(body).toBeFocused();
  await expect.poll(() => page.evaluate(() => Reflect.get(window, '__editor').state.selection.from)).toBe(2);
  await search(page);
  await page.keyboard.press('Meta+k');
  await expect(body).toBeFocused();
  await page.getByRole('button', { name: 'Search library', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(body).toBeFocused();
  await title(page).click();
  await search(page);
  await page.keyboard.press('Escape');
  await expect(title(page)).toBeFocused();
  await page.keyboard.press('Meta+n');
  await expect(title(page)).toHaveValue('');
  await title(page).fill('Another note');
  await search(page, 'Resume writing');
  await page.keyboard.press('Enter');
  await expect(body).toBeFocused();
  await page.keyboard.type(' again');
  await expect(body).toHaveText('Before after again');
});

// A result can still be focusing its editor when the next search starts.
test('typing goes into search when Cmd K immediately follows opening a result', async ({ page }) => {
  await page.clock.install();
  await start(page);
  await page.keyboard.press('Meta+n');
  await title(page).fill('Field guide');
  await title(page).press('Enter');
  const body = page.getByRole('textbox', { name: 'Page body', exact: true });
  await expect(body).toBeFocused();
  await page.keyboard.type('Original text');
  await page.keyboard.press('Meta+n');
  await expect(title(page)).toHaveValue('');
  await search(page, 'Field guide');
  await page.clock.pauseAt(new Date(await page.evaluate(() => Date.now() + 100)));
  await page.keyboard.press('Enter');
  await page.clock.runFor(16);
  await page.keyboard.press('Meta+k');
  await page.keyboard.type('cedar');
  // Type again after the editor's deferred focus has had a chance to run.
  await page.clock.runFor(32);
  await page.keyboard.type(' trail');
  await expect(input(page)).toHaveValue('cedar trail');
  await expect(input(page)).toBeFocused();
  await page.clock.resume();
  await page.keyboard.press('Escape');
  await expect(title(page)).toHaveValue('Field guide');
  await expect(body).toHaveText('Original text');
  await page.reload();
  await expect(body).toHaveText('Original text');
});

// An explicit creation command must win even when a saved page has the exact same title.
test('create a plain page or a named typed page from the first screen', async ({ page }) => {
  await start(page);
  await search(page);
  await dialog(page).getByRole('option', { name: 'Page', exact: true }).click();
  await expect(title(page)).toBeFocused();
  await title(page).fill('New');
  await page.keyboard.press('Meta+n');
  await expect(title(page)).toHaveValue('');
  await title(page).fill('new meeting Friday review');
  await search(page, 'New');
  await expect(dialog(page).getByRole('option').first()).toHaveAttribute('aria-label', 'New');
  await input(page).fill('new meeting Friday review');
  await expect(dialog(page).getByRole('option').first()).toHaveAttribute('aria-label', 'New meeting “Friday review”');
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveValue('Friday review');
  await expect(page.getByRole('textbox', { name: 'Page body' })).toBeFocused();
  await search(page, 'Friday review');
  await expect(dialog(page).getByRole('option', { name: 'Friday review', exact: true })).toContainText('Meeting');
  await page.keyboard.press('Meta+2');
  await expect(input(page)).toHaveValue('Friday review');
  await expect(dialog(page).getByRole('option', { name: 'New page “Friday review”' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Page body' })).toBeFocused();
  await expect(title(page)).toHaveValue('Friday review');
  await search(page, 'Neighborhood walk');
  await expect(dialog(page).getByRole('option', { name: 'New page “Neighborhood walk”' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(title(page)).toHaveValue('Neighborhood walk');
  await page.getByRole('button', { name: 'Choose page type' }).click();
  await expect(dialog(page).getByRole('gridcell', { name: 'Book', exact: true })).toBeVisible();
  await page.screenshot({ path: 'qa/report/search-create-types.png' });
  await dialog(page).getByRole('gridcell', { name: 'Book', exact: true }).click();
  await expect(title(page)).toBeFocused();
});

// Category changes remount the command input. Both traversal directions must preserve the query and focus.
test('Tab cycles search categories and wraps without losing the query', async ({ page }) => {
  await start(page);
  await search(page, 'field notes');
  for (const [key, category] of [
    ['Shift+Tab', 'Tabs'], ['Tab', 'All'], ['Tab', 'Create'], ['Tab', 'Pages'],
    ['Tab', 'Types'], ['Tab', 'Tabs'], ['Tab', 'All'], ['Meta+3', 'Pages'],
  ]) {
    await page.keyboard.press(key);
    await expect(dialog(page).getByRole('radio', { name: category, exact: true })).toBeChecked();
    await expect(input(page)).toBeFocused();
    await expect(input(page)).toHaveValue('field notes');
  }
});

// A browser tab and its native surface used to share one identity across the workspace.
test('Quick create keeps the source tab and opens beside the focused pane', async ({ page }) => {
  test.setTimeout(120_000);
  await start(page);
  const address = page.getByRole('combobox', { name: 'Search or enter address' });
  const panes = page.locator('[data-pane]:visible');
  const websites = page.getByTestId('standin-page').filter({ visible: true });
  async function create(choice: 'Idea' | 'Page' | 'Browser tab', beside = false) {
    await page.keyboard.press('Meta+k');
    const rows = dialog(page).getByRole('group', { name: 'Create', exact: true }).getByRole('option');
    await expect(rows).toHaveText(['Idea', 'Page', 'Browser tab']);
    await expect(rows.first()).toHaveAttribute('data-highlighted', '');
    const index = ['Idea', 'Page', 'Browser tab'].indexOf(choice);
    for (let i = 0; i < index; i++) await page.keyboard.press('ArrowDown');
    await expect(rows.nth(index)).toHaveAttribute('data-highlighted', '');
    await page.keyboard.press(beside ? 'Shift+Enter' : 'Enter');
    await expect(dialog(page)).toBeHidden();
  }

  await create('Idea');
  await expect(title(page)).toBeFocused();
  await title(page).fill('Field notes');
  await create('Page');
  await expect(title(page)).toBeFocused();
  await title(page).fill('Reading list');
  await expect(page.getByRole('tab', { name: /^Field notes/ })).toBeVisible();
  await create('Browser tab');
  await expect(address).toBeFocused();
  await address.fill('https://atlas.example/Maps');
  await address.press('Enter');
  await expect(websites).toContainText('atlas.example');
  await expect(panes).toHaveCount(1);

  await create('Browser tab', true);
  await expect(address).toBeFocused();
  await address.press('Escape');
  await expect(panes).toHaveCount(2);
  await expect(page.getByRole('button', { name: /Enter address/ })).toBeVisible();
  await page.keyboard.press('Meta+l');
  await address.fill('https://library.example/Books');
  await address.press('Enter');
  await expect(websites).toHaveCount(2);
  await expect(page.locator('[data-testid="standin-page"][data-live="true"]:visible')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('[data-testid="standin-page"][data-live="true"]:visible')).toHaveCount(2);
  await websites.filter({ hasText: 'library.example' }).click();
  await create('Page');
  await expect(title(page)).toBeFocused();
  await expect(panes).toHaveCount(2);
  await expect(websites).toContainText('atlas.example');
  await page.getByRole('tab', { name: /^Books Close tab$/ }).click();
  await websites.filter({ hasText: 'atlas.example' }).click();
  await create('Idea', true);
  await expect(title(page)).toBeFocused();
  await title(page).fill('Map idea');
  await expect(panes).toHaveCount(3);
  await expect(websites).toHaveCount(2);
  await create('Page', true);
  await expect(title(page).and(page.locator(':focus'))).toHaveValue('');
  await expect(panes).toHaveCount(4);
});
