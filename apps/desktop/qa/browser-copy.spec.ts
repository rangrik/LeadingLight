import { test, expect, type Page } from '@playwright/test';
import { resolve } from 'node:path';
test.setTimeout(60_000);
const old = 'https://leadinglight-web.vercel.app', next = 'https://leadinglight.app';
const stores = ['objects', 'types', 'props', 'folders', 'history', 'pending-history'];
const records = (page: Page) => page.evaluate(async (names) => {
  const db = await new Promise<IDBDatabase>((resolve) => { const r = indexedDB.open('leadinglight', 5); r.onsuccess = () => resolve(r.result); });
  const tx = db.transaction(names), result: Record<string, unknown[]> = {};
  await Promise.all(names.map((name) => new Promise<void>((resolve) => { const r = tx.objectStore(name).getAll(); r.onsuccess = () => { result[name] = r.result; resolve(); }; })));
  db.close(); return result;
}, stores);
test.beforeEach(async ({ context, baseURL }) => {
  await context.route(/^https:\/\/(leadinglight-web\.vercel\.app|leadinglight\.app)\//, async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.startsWith('/api/')) return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ready: false, providers: [], allowed: false }) });
    if (url.pathname === '/sw.js') return route.fulfill({ status: 404, body: '' });
    if (process.env.QA_COPY_BUILD) return route.fulfill({ path: resolve('dist', url.pathname === '/' ? 'index.html' : `.${url.pathname}`) });
    const response = await route.fetch({ maxRetries: 3, url: `${baseURL}${url.pathname}${url.search}` });
    await route.fulfill({ response });
  });
});
const note = async (page: Page) => {
  await page.goto(old);
  await page.getByRole('navigation', { name: 'Recent' }).getByRole('button', { name: 'New page' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Address migration');
  await page.getByRole('textbox', { name: 'Title' }).press('Enter');
  await page.keyboard.type('Keep my creative work and its history.');
};
const copy = async (page: Page) => {
  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Copy notes to leadinglight.app', exact: true }).click();
  return opened;
};

// Seam: copying across origins preserves stored content/history, without moving credentials or deleting the source.
test('copy browser notes and history between origins', async ({ page }) => {
  await note(page);
  await page.evaluate(() => {
    localStorage.setItem('leadinglight.sync-key:owner', 'private-recovery-key');
    localStorage.setItem('ll.threads.fixture', JSON.stringify([{ id: 'chat', items: [{ kind: 'text', text: 'Saved conversation' }], allowed: ['delete'], sessionId: 'device-session', remoteRun: 'running' }]));
  });
  const target = await copy(page);
  await expect(target.getByText('Your workspace is copied', { exact: true })).toBeVisible({ timeout: 20_000 });
  const before = await records(page), after = await records(target);
  expect(after).toEqual(before);
  expect(after.history.length).toBeGreaterThan(0);
  expect(await target.evaluate(() => localStorage.getItem('leadinglight.sync-key:owner'))).toBeNull();
  const thread = await target.evaluate(() => JSON.parse(localStorage.getItem('ll.threads.fixture')!)[0]);
  expect(thread.allowed).toEqual([]); expect(thread.sessionId).toBeUndefined(); expect(thread.items[0].text).toBe('Saved conversation');
  await target.screenshot({ path: 'qa/report/browser-copy-complete.png' });
  await target.getByRole('link', { name: 'Open your notes' }).click();
  await expect(target.getByRole('textbox', { name: 'Page body' })).toContainText('Keep my creative work', { timeout: 20_000 });
  await page.reload();
  await expect(page.getByRole('textbox', { name: 'Page body' })).toContainText('Keep my creative work', { timeout: 20_000 });
});

test('existing destination refuses copying without changing either workspace', async ({ page, context }) => {
  await note(page);
  const existing = await context.newPage(); await existing.goto(next);
  await existing.getByRole('button', { name: 'Start a new workspace here' }).click();
  await expect(existing.getByRole('navigation', { name: 'Recent' })).toBeVisible();
  const before = await records(existing);
  const target = await copy(page);
  await expect(target.getByText(/This address already has a workspace/)).toBeVisible({ timeout: 20_000 });
  expect(await records(target)).toEqual(before);
  await expect(page.getByRole('textbox', { name: 'Page body' })).toContainText('Keep my creative work', { timeout: 20_000 });
  await target.screenshot({ path: 'qa/report/browser-copy-refused.png' });
});

test('spoofed messages and blocked popups cannot import a workspace', async ({ page, context }) => {
  await page.goto(old);
  const target = await context.newPage(); await target.goto(`${next}/?copy=00000000-0000-0000-0000-000000000000`);
  await expect(target.getByText('Open your original workspace and choose Copy notes to leadinglight.app.')).toBeVisible();
  await target.evaluate(() => window.dispatchEvent(new MessageEvent('message', { origin: 'https://untrusted.test', source: window, data: { type: 'copy-data', code: new URLSearchParams(location.search).get('copy'), data: {} } })));
  await expect(target.getByText('Your workspace is copied', { exact: true })).not.toBeVisible();
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole('button', { name: 'Copy notes to leadinglight.app', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Allow this site to open a new tab');
});
