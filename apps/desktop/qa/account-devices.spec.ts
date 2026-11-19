import { expect, test, type Page } from '@playwright/test';

const known = { id: 'owner-a', name: 'Alex Rivera', email: 'alex@example.test', provider: 'google' };
const row = (page: Page) => page.getByRole('button', { name: /^Account and sync/ });
// A device that synced as `known` before this page load.
const synced = (page: Page) => page.addInitScript((known) => {
  localStorage.setItem('leadinglight.account', JSON.stringify(known));
  localStorage.setItem('leadinglight.sync-owner', known.id);
  localStorage.setItem(`leadinglight.sync-key:${known.id}`, btoa('k'.repeat(32)));
}, known);
const cloud = (page: Page, me: { status: number; body: object } | 'unreachable') => page.route('**/api/**', (route) => {
  const path = new URL(route.request().url()).pathname;
  if (me === 'unreachable') return route.abort();
  if (path === '/api/config') return route.fulfill({ json: { ready: true, allowed: true, providers: [{ id: 'google', name: 'Google' }] } });
  return path === '/api/me' ? route.fulfill({ status: me.status, json: me.body }) : route.fulfill({ json: { events: [], devices: [] } });
});

// Seam: only the service's own "no" is a sign-out. Read wrongly, a signed-in person is told to sign in, or a real sign-out goes unseen.
test('a sign-in that ended says so, and an unreachable service does not', async ({ page }) => {
  await synced(page); await cloud(page, { status: 401, body: { error: 'This connection expired or was revoked.' } });
  await page.goto('/');
  await expect(row(page)).toHaveAccessibleName('Account and sync · Sign in');
  await row(page).click();
  const section = page.getByTestId('settings-account');
  await expect(section.getByRole('status').filter({ hasText: 'This browser is signed out of sync' })).toContainText('alex@example.test · Google');
  await expect(section.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(section.getByRole('button', { name: 'Show…' })).toBeVisible();

  await page.unroute('**/api/**'); await cloud(page, 'unreachable');
  await page.reload();
  await expect(row(page)).toHaveAccessibleName('Account and sync · Offline');
  await row(page).click();
  await expect(section).toContainText('alex@example.test · Google');
  await expect(section.getByText('signed out of sync')).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Continue with Google' })).toHaveCount(0);
});

// Seam: notes bound to one account must not sync as another, and the page has to say which account they belong to.
test('another account is told whose notes these are and cannot sync them', async ({ page }) => {
  await synced(page); await cloud(page, { status: 200, body: { id: 'owner-b', name: 'Alex Rivera', email: 'alex-r@example.test', provider: 'github' } });
  await page.goto('/');
  await expect(row(page)).toHaveAccessibleName('Account and sync · Check');
  await row(page).click();
  const section = page.getByTestId('settings-account');
  await expect(section.getByRole('alert').filter({ hasText: 'These notes sync with alex@example.test · Google' })).toContainText('You are signed in as alex-r@example.test · GitHub');
  await expect(section.getByRole('button', { name: 'Turn on sync' })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Show…' })).toHaveCount(0);
  await expect(section.getByRole('button', { name: 'Add a device' })).toHaveCount(0);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('leadinglight.account')!).id)).toBe('owner-a');
});
