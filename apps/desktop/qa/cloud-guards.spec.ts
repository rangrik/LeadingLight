import { expect, test } from '@playwright/test';

// Seam: a failed logout must not claim the server session was cleared.
test('sign-out keeps the account on failure and clears it on success', async ({ page }) => {
  let signedIn = true, failure: 'http' | 'redirect' | null = 'http';
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let status = 200, body: unknown = {};
    if (path === '/api/config') body = { ready: true, allowed: true, providers: [{ id: 'github', name: 'GitHub' }], agents: [] };
    if (path === '/api/me') { status = signedIn ? 200 : 401; body = signedIn ? { id: 'logout-test', name: 'Logout test account' } : { error: 'Sign in first.' }; }
    if (path === '/api/jobs') body = { jobs: [] };
    if (path === '/api/auth/csrf') body = { csrfToken: 'test-csrf' };
    if (path === '/api/auth/signout') { status = failure === 'http' ? 500 : 200; signedIn = failure !== null; body = { url: new URL(route.request().url()).origin + (failure === 'redirect' ? '?error=MissingCSRF' : '') }; }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Account and sync' }).click();
  await expect(page.getByText('Logout test account', { exact: true })).toBeVisible();
  for (const mode of ['http', 'redirect'] as const) {
    failure = mode;
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('You are still signed in');
    await expect(page.getByText('Logout test account', { exact: true })).toBeVisible();
  }
  failure = null;
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
  await expect(page.getByText('Logout test account', { exact: true })).not.toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Account and sync' }).click();
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
});

// Seam: old task state and stale server configuration cannot start hosted model work.
test('browser agents explain local execution and never upload an old outbox', async ({ page }) => {
  const uploads: string[] = [];
  let configurations = 0;
  await page.addInitScript(() => localStorage.setItem('leadinglight.cloud-outbox', JSON.stringify([{ owner: 'local-agent-test', id: 'old-task', provider: 'gpt', text: 'Private old context', prompt: 'Draft' }])));
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.startsWith('/api/jobs')) uploads.push(route.request().method());
    if (path === '/api/config') configurations++;
    const body = path === '/api/config' ? { ready: true, allowed: true, providers: [], agents: [{ id: 'gpt', name: 'GPT', model: 'old-model' }] } : path === '/api/me' ? { id: 'local-agent-test', name: 'Local agent account' } : { jobs: [] };
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Account and sync' }).click();
  await expect(page.getByText('Local agent account', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'Agents', exact: true }).click();
  await expect(page.getByRole('tabpanel', { name: 'Agents', exact: true })).toContainText('already signed in on your Mac');
  await expect(page.getByRole('button', { name: 'Send task' })).toHaveCount(0);
  await expect(page.getByRole('dialog')).not.toContainText('API keys');
  const before = configurations;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => configurations).toBeGreaterThan(before);
  await page.getByRole('tab', { name: 'Sync', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Set up encrypted sync' })).toBeEnabled();
  expect(uploads).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('leadinglight.cloud-outbox'))).toContain('Private old context');
});

// Seam: the production browser must never mount the local development agent stand-in.
test('production browser Ask explains the installed-app requirement', async ({ page }) => {
  test.skip(!process.env.OFFLINE_QA, 'Build and serve the production app at OFFLINE_QA first.');
  await page.goto(process.env.OFFLINE_QA!);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  const panel = page.getByRole('region', { name: 'Agent', exact: true });
  await expect(panel).toContainText('Agents work on your Mac');
  await expect(panel).toContainText('existing Claude Code or Codex sign-in');
  await expect(panel.getByRole('textbox', { name: 'Question' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.getByRole('navigation', { name: 'Recent' }).getByRole('button', { name: 'New page' }).click();
  await page.getByRole('textbox', { name: 'Title' }).fill('Local agents');
  const body = page.getByRole('textbox', { name: 'Page body' });
  await body.fill('These selected words stay on this device.');
  for (const entry of ['selection', 'keyboard', 'page']) {
    await body.click();
    await body.press('Meta+ArrowLeft');
    for (let letter = 0; letter < 5; letter++) await body.press('Shift+ArrowRight');
    if (entry === 'selection') await page.getByRole('button', { name: 'Ask about this', exact: true }).click();
    else if (entry === 'keyboard') await page.keyboard.press('Meta+J');
    else await page.getByRole('button', { name: 'Ask Claude', exact: true }).click();
    await expect(panel).toContainText('Agents work on your Mac');
    await expect(page.getByRole('textbox', { name: /^(Question|Ask Claude about this)$/ })).toHaveCount(0);
    await expect(page.getByRole('toolbar', { name: 'Ask Claude', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Ask', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await page.screenshot({ path: `qa/report/local-agents-${test.info().project.name}.png`, animations: 'disabled' });
});
