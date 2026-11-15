import { expect, test } from '@playwright/test';
import type { BrowserContext, Page } from '@playwright/test';
const account = async (context: BrowserContext, owner: string) => context.addCookies([{ name: 'qa-user', value: owner, url: 'http://127.0.0.1:1431' }]);
const create = async (page: Page, title: string, words: string) => {
  await page.getByRole('navigation', { name: 'Recent' }).getByRole('button', { name: 'New page' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill(title);
  await page.getByRole('textbox', { name: 'Title' }).press('Enter');
  await page.keyboard.type(words);
};
const settings = (page: Page) => page.getByRole('button', { name: 'Account and sync' }).click();
// Turning sync on shows the new key once; it is read there, and ticked as saved.
const turnOn = async (page: Page) => {
  await page.getByRole('button', { name: 'Turn on sync', exact: true }).click();
  const key = (await page.getByTestId('recovery-key').textContent())!;
  await page.getByRole('checkbox', { name: 'I saved it somewhere safe' }).click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('Up to date', { exact: true })).toBeVisible();
  return key;
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
  await settings(one);
  const key = await turnOn(one);
  const stored = await one.evaluate(async () => (await (await fetch('/api/sync')).json()).events);
  expect(JSON.stringify(stored)).not.toContain('Original words');
  await settings(two);
  await two.getByRole('button', { name: 'Turn on sync', exact: true }).click();
  await two.getByLabel('Recovery key', { exact: true }).fill(key);
  await two.getByRole('button', { name: 'Unlock notes', exact: true }).click();
  await expect(two.getByText('Up to date', { exact: true })).toBeVisible();
  await one.getByRole('button', { name: 'Back to app' }).click();
  await two.getByRole('button', { name: 'Back to app' }).click();
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
  await settings(page);
  const key = await turnOn(page);
  await page.getByRole('switch', { name: 'Sync this browser' }).click();
  // The page offers another key only when sync reports a mismatch, so the check itself is called here.
  const use = (other: string) => page.evaluate(async (other) => { try { await (await import('/src/lib/' + 'sync.ts')).enableSync(other); return ''; } catch (e) { return String(e); } }, other);
  expect(await use(Buffer.alloc(32, 7).toString('base64'))).toContain('Your existing key has been kept');
  expect(await page.evaluate((id) => localStorage.getItem(`leadinglight.sync-key:${id}`), owner)).toBe(key);
  await page.route('**/api/sync?after=0', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Temporarily unavailable' }) }));
  expect(await use(Buffer.alloc(32, 7).toString('base64'))).toContain('Temporarily unavailable');
  expect(await page.evaluate((id) => localStorage.getItem(`leadinglight.sync-key:${id}`), owner)).toBe(key);
  await page.unroute('**/api/sync?after=0');
  await page.getByRole('switch', { name: 'Sync this browser' }).click();
  await expect(page.getByText('Up to date', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Show…', exact: true }).click();
  await expect(page.getByTestId('recovery-key')).toHaveText(key);
});

// Seam: phone layout and touch navigation must reach the same editor, history and account UI.
for (const width of [390, 820]) test(`web workspace fits ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 844 }); await page.goto('/');
  if (width < 768) await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await page.getByRole('navigation', { name: 'Recent' }).getByRole('button', { name: 'New page' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Mobile note');
  await page.getByRole('textbox', { name: 'Title' }).press('Enter'); await page.keyboard.type('A thought on the go.');
  await page.getByRole('button', { name: 'Page actions', exact: true }).click();
  await page.getByRole('menuitem', { name: 'History and authorship', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Inspect authorship' }).click();
  await expect(page.getByRole('dialog')).toContainText('A thought on the go.');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `qa/report/authorship-${width}.png` });
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  if (width < 768) await page.getByRole('button', { name: 'Toggle Sidebar' }).click();
  await settings(page);
  const section = page.getByTestId('settings-account');
  await expect(section.getByRole('heading', { name: 'Account and devices' })).toBeVisible();
  await expect(section).toContainText('already signed in on your Mac');
  expect(await section.evaluate((el) => el.scrollWidth <= el.clientWidth && document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `qa/report/account-${width}.png`, animations: 'disabled' });
});
