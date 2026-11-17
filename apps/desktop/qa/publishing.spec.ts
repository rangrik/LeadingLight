import { expect, test } from '@playwright/test';

test.skip(!process.env.PUBLISH_QA, 'Needs the isolated cloud test server.');

// Seam: the real publish UI must serve the latest local page to a visitor with no workspace.
test('publish with sidenotes, read on desktop and phone, update and revoke', async ({ page, context, browser, baseURL }, testInfo) => {
  await context.addCookies([{ name: 'qa-user', value: `publishing-${Date.now()}`, url: baseURL! }]);
  await page.goto('/');
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('A shared page');
  await page.getByRole('textbox', { name: 'Title', exact: true }).press('Enter');
  const body = page.getByRole('textbox', { name: 'Page body', exact: true });
  await expect(body).toBeFocused();
  await page.keyboard.type('A sentence with a sidenote.');
  await page.keyboard.press('ControlOrMeta+Shift+m');
  const note = page.getByRole('textbox', { name: 'Sidenote 1', exact: true });
  await expect(note).toBeVisible();
  await note.fill('A thought that readers should see.');
  await note.press('ControlOrMeta+Enter');
  await page.getByRole('button', { name: 'Page options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Publish page…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish page', exact: true });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const share = dialog.getByRole('textbox', { name: 'Share link' });
  await expect(share).toBeVisible();
  const url = await share.inputValue();
  await page.screenshot({ path: 'qa/report/publish-dialog.png' });
  const visitor = await browser.newContext({ recordVideo: { dir: testInfo.outputPath('reader-video'), size: { width: 1280, height: 800 } } });
  const reader = await visitor.newPage();
  const errors: string[] = [];
  reader.on('pageerror', (error) => errors.push(error.message));
  const response = await reader.goto(url);
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
  await expect(reader.getByRole('heading', { name: 'A shared page' })).toBeVisible();
  const sharedBody = reader.getByRole('textbox', { name: 'Published page' });
  await expect(sharedBody).toHaveAttribute('contenteditable', 'false');
  const sharedNote = reader.getByRole('textbox', { name: 'Sidenote 1' });
  await expect(sharedNote).toHaveText('A thought that readers should see.');
  await expect(sharedNote).toHaveAttribute('contenteditable', 'false');
  await expect(reader.locator('[contenteditable=true]')).toHaveCount(0);
  await expect(reader.getByRole('button', { name: 'Remove sidenote' })).toHaveCount(0);
  await expect(reader.getByRole('button', { name: 'New page' })).toHaveCount(0);
  await reader.screenshot({ path: 'qa/report/published-desktop.png', fullPage: true });
  await reader.setViewportSize({ width: 390, height: 844 });
  await expect(sharedNote).toBeVisible();
  expect(await reader.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await reader.screenshot({ path: 'qa/report/published-phone.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Revised title');
  await reader.reload();
  await expect(reader.getByRole('heading', { name: 'A shared page' })).toBeVisible();
  await page.getByRole('button', { name: 'Publish page', exact: true }).click();
  await dialog.getByRole('button', { name: 'Update published page' }).click();
  await expect(dialog.getByRole('status')).toContainText('Published.');
  expect(await share.inputValue()).toBe(url);
  await reader.reload();
  await expect(reader.getByRole('heading', { name: 'Revised title' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(dialog.getByRole('status')).toContainText('Unpublished.');
  await reader.reload();
  await expect(reader.getByRole('alert')).toHaveText('This page is unavailable');
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  await expect(share).toBeVisible();
  expect(await share.inputValue()).not.toBe(url);
  await reader.reload();
  await expect(reader.getByRole('alert')).toHaveText('This page is unavailable');
  expect(errors).toEqual([]);
  await visitor.close();
  await testInfo.attach('Signed-out reader', { path: await reader.video()!.path(), contentType: 'video/webm' });
});

test('sign in is required', async ({ page }) => {
  await page.goto('/');
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  await page.getByRole('button', { name: 'Publish page', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish page', exact: true });
  await expect(dialog.getByRole('button', { name: 'Account and devices' })).toBeVisible();
  await expect(dialog.getByRole('button', { name: 'Publish', exact: true })).toHaveCount(0);
});

// Seam: lost responses and local deletion must not strand a published link.
test('retry failures and unpublish a deleted page from account settings', async ({ page, context, baseURL, request }) => {
  await context.addCookies([{ name: 'qa-user', value: `publishing-errors-${Date.now()}`, url: baseURL! }]);
  await page.goto('/');
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Revocable after deletion');
  await page.route('**/api/publications/status', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Try the connection again.' }) }));
  await page.getByRole('button', { name: 'Publish page', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish page', exact: true });
  await expect(dialog.getByRole('alert')).toContainText('Try the connection again.');
  await page.unroute('**/api/publications/status');
  await dialog.getByRole('button', { name: 'Try again' }).click();
  await page.route('**/api/publications/publish', async (route) => { await route.fetch(); await route.abort('failed'); }, { times: 1 });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('textbox', { name: 'Share link' });
  await expect(link).toBeVisible();
  await expect(dialog.getByRole('alert')).toBeVisible();
  const url = await link.inputValue(), api = `${baseURL}/api/published/${url.split('/').pop()}`;
  await page.route('**/api/publications/publish', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Upload failed.' }) }), { times: 1 });
  await dialog.getByRole('button', { name: 'Update published page' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Upload failed.');
  expect((await (await request.get(api)).json()).title).toBe('Revocable after deletion');
  await page.route('**/api/publications/unpublish', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Unpublish failed.' }) }), { times: 1 });
  await dialog.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Unpublish failed.');
  await expect(link).toHaveValue(url);
  expect((await request.get(api)).status()).toBe(200);
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Page options', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Delete page…', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: 'Delete', exact: true }).click();
  await page.getByRole('button', { name: 'Account and sync' }).click();
  await page.getByRole('button', { name: 'Manage published pages' }).click();
  const manage = page.getByRole('dialog', { name: 'Published pages', exact: true });
  await expect(manage.getByText('Revocable after deletion', { exact: true })).toBeVisible();
  await manage.getByRole('button', { name: 'Unpublish', exact: true }).click();
  await expect(manage.getByText('No published pages.')).toBeVisible();
  expect((await request.get(api)).status()).toBe(404);
});

// Seam: media node views have their own upload forms, outside the editor's contenteditable guard.
test('readers cannot replace broken or empty media', async ({ page, context, browser, baseURL }, testInfo) => {
  await context.addCookies([{ name: 'qa-user', value: `publishing-media-${Date.now()}`, url: baseURL! }]);
  await page.goto('/');
  await page.getByRole("button", { name: "New page", exact: true }).first().click();
  await page.getByRole('textbox', { name: 'Title', exact: true }).fill('Media without edit controls');
  await page.getByRole('textbox', { name: 'Title', exact: true }).press('Enter');
  await page.evaluate(() => (window as unknown as { __editor: { commands: { setContent: (doc: unknown) => void } } }).__editor.commands.setContent({ type: 'doc', content: [{ type: 'image', attrs: { src: 'data:image/png;base64,aA==', mime: 'image/png' } }, { type: 'audio' }, { type: 'video' }, { type: 'file' }, { type: 'embed' }] }));
  await page.getByRole('button', { name: 'Publish page', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Publish page', exact: true });
  await dialog.getByRole('button', { name: 'Publish', exact: true }).click();
  const link = dialog.getByRole('textbox', { name: 'Share link' });
  await expect(link).toBeVisible();
  const visitor = await browser.newContext({ recordVideo: { dir: testInfo.outputPath('reader-video'), size: { width: 1280, height: 800 } } }), reader = await visitor.newPage();
  await reader.goto(await link.inputValue());
  await expect(reader.getByRole('heading', { name: 'Media without edit controls' })).toBeVisible();
  await expect(reader.getByText("This image can't be shown")).toBeVisible();
  await expect(reader.locator('input[type=file], form, [contenteditable=true]')).toHaveCount(0);
  await visitor.close();
  await testInfo.attach('Signed-out media', { path: await reader.video()!.path(), contentType: 'video/webm' });
});

// Seam: a malformed or newer public response must not crash into a blank page.
test('a malformed public response shows a retryable error', async ({ page }) => {
  await page.route('**/api/published/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ title: 'Malformed' }) }));
  await page.goto(`/p/${'x'.repeat(32)}`);
  await expect(page.getByRole('alert')).toContainText('could not be read');
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
});

// Seam: public node views must restrict embeds, disable tasks and keep wide tables readable.
test('reader embeds are restricted and controls remain readable on a phone', async ({ page }) => {
  const paragraph = (text: string) => ({ type: 'paragraph', content: [{ type: 'text', text }] });
  const snapshot = { version: 1, title: 'Public reading controls', description: '', notes: [], content: { type: 'doc', content: [
    { type: 'embed', attrs: { src: 'https://example.com/embedded-form' } },
    { type: 'embed', attrs: { src: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } },
    { type: 'taskList', content: [{ type: 'taskItem', attrs: { checked: false }, content: [paragraph('Read only task')] }] },
    { type: 'table', content: [{ type: 'tableRow', content: Array.from({ length: 7 }, (_, index) => ({ type: 'tableCell', content: [paragraph(`Readable column ${index + 1}`)] })) }] },
  ] } };
  await page.route('https://www.youtube-nocookie.com/**', (route) => route.fulfill({ body: '' }));
  await page.route('**/api/published/**', (route) => route.fulfill({ json: snapshot }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/p/${'x'.repeat(32)}`);
  await expect(page.getByRole('heading', { name: snapshot.title })).toBeVisible();
  await expect(page.getByRole('link', { name: 'https://example.com/embedded-form' })).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(1);
  await expect(page.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-presentation');
  await expect(page.getByRole('checkbox')).toBeDisabled();
  expect(await page.locator('.tableWrapper').evaluate((table) => table.scrollWidth > table.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'qa/report/published-controls-phone.png', fullPage: true });
});
