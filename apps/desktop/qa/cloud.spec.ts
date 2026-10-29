import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
const account = async (context: BrowserContext, owner: string) => context.addCookies([{ name: 'qa-user', value: owner, url: 'http://127.0.0.1:1431' }]);
const create = async (page: Page, title: string, words: string) => {
  await page.getByRole('navigation', { name: 'Recent' }).getByRole('button', { name: 'New page' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('textbox', { name: 'Title' }).press('Enter');
  await page.keyboard.type(words);
};
const settings = async (page: Page, tab: string) => {
  await page.getByRole('button', { name: 'Account and sync' }).click();
  await page.getByRole('tab', { name: tab, exact: true }).click();
};

// Seam: separate browser databases exchange only encrypted events, preserving offline conflicts.
test('two devices sync encrypted history and preserve conflicting edits', async ({ browser }) => {
  test.skip(!process.env.CLOUD_QA, 'Requires the isolated cloud fixture server.');
  test.setTimeout(90_000);
  const owner = `qa-${Date.now()}`;
  const a = await browser.newContext(), b = await browser.newContext();
  await account(a, owner); await account(b, owner);
  const one = await a.newPage(), two = await b.newPage();
  await one.goto('http://127.0.0.1:1431'); await two.goto('http://127.0.0.1:1431');
  await create(one, 'Shared note', 'Original words.');
  await settings(one, 'Sync');
  await one.getByRole('button', { name: 'Set up encrypted sync' }).click();
  await expect(one.getByText('Up to date', { exact: true })).toBeVisible();
  const key = await one.getByLabel('Recovery key — save this somewhere private').inputValue();
  const stored = await one.evaluate(async () => (await (await fetch('/api/sync')).json()).events);
  expect(JSON.stringify(stored)).not.toContain('Original words');
  await settings(two, 'Sync');
  await two.getByLabel('Connecting another device?').fill(key);
  await two.getByRole('button', { name: 'Connect this device', exact: true }).click();
  await expect(two.getByText('Up to date', { exact: true })).toBeVisible();
  await one.getByRole('button', { name: 'Close', exact: true }).click();
  await two.getByRole('button', { name: 'Close', exact: true }).click();
  await two.getByRole('navigation', { name: 'Recent' }).getByRole('button', { name: 'Shared note', exact: true }).click();
  await expect(two.getByRole('textbox', { name: 'Page body' })).toContainText('Original words.');
  await a.setOffline(true); await b.setOffline(true);
  await one.getByRole('textbox', { name: 'Page body' }).fill('First device edits.');
  await two.getByRole('textbox', { name: 'Page body' }).fill('Second device edits.');
  await a.setOffline(false);
  await one.evaluate(async () => { const m = await import('/src/lib/' + 'sync.ts'); await m.syncNow(); });
  await b.setOffline(false);
  await two.evaluate(async () => { const m = await import('/src/lib/' + 'sync.ts'); await m.syncNow(); });
  await expect(two.getByRole('navigation', { name: 'Recent' }).getByRole('button', { name: /conflicting copy/ })).toBeVisible();
  await expect(two.getByRole('textbox', { name: 'Page body' })).toContainText('Second device edits.');
  await a.close(); await b.close();
});

// Seam: recovery must verify a candidate key before replacing the only working local key.
test('wrong recovery keys and server errors preserve the saved key', async ({ page, context }) => {
  test.skip(!process.env.CLOUD_QA, 'Requires the isolated cloud fixture server.');
  const owner = `qa-key-${Date.now()}`;
  await account(context, owner); await page.goto('/');
  await create(page, 'Key recovery', 'Words protected by the original key.');
  await settings(page, 'Sync');
  await page.getByRole('button', { name: 'Set up encrypted sync' }).click();
  await expect(page.getByText('Up to date', { exact: true })).toBeVisible();
  const key = await page.getByLabel('Recovery key — save this somewhere private').inputValue();
  await page.getByRole('button', { name: 'Pause sync on this device' }).click();
  await page.getByLabel('Connecting another device?').fill(Buffer.alloc(32, 7).toString('base64'));
  await page.getByRole('button', { name: 'Connect this device', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your existing key has been kept');
  expect(await page.evaluate((id) => localStorage.getItem(`leadinglight.sync-key:${id}`), owner)).toBe(key);
  await page.route('**/api/sync?after=0', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable' }) }));
  await page.getByRole('button', { name: 'Connect this device', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Temporarily unavailable');
  expect(await page.evaluate((id) => localStorage.getItem(`leadinglight.sync-key:${id}`), owner)).toBe(key);
  await page.unroute('**/api/sync?after=0');
  await page.getByLabel('Connecting another device?').fill('');
  await page.getByRole('button', { name: 'Resume sync', exact: true }).click();
  await expect(page.getByText('Up to date', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Recovery key — save this somewhere private')).toHaveValue(key);
});

// Seam: phone layout and touch navigation must reach the same editor, history and account UI.
for (const width of [390, 820]) test(`web workspace fits ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 }); await page.goto('/');
  if (width < 768) await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await page.getByRole('navigation', { name: 'Recent' }).getByRole('button', { name: 'New page' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Mobile note');
  await page.getByRole('textbox', { name: 'Title' }).press('Enter'); await page.keyboard.type('A thought on the go.');
  await page.getByRole('button', { name: 'History and authorship' }).click();
  await page.getByRole('menuitem', { name: 'Inspect authorship' }).click();
  await expect(page.getByRole('dialog')).toContainText('A thought on the go.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `qa/report/authorship-${width}.png` });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  if (width < 768) await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await settings(page, 'Account');
  await expect(page.getByRole('button', { name: 'Continue on this device' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `qa/report/account-${width}.png` });
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Agents', exact: true })).toContainText('already signed in on your Mac');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `qa/report/agents-${width}.png`, animations: 'disabled' });
});
