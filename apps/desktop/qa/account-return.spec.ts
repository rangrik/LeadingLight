import { expect, test } from '@playwright/test';

// Seam: opening Mail during startup must not erase the web callback's cancellation notice.
for (const connected of [false, true]) test(`web cancellation survives startup with ${connected ? 'an' : 'no'} account`, async ({ page }) => {
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = path === '/api/config' ? { ready: true, allowed: true, providers: [] }
      : path === '/api/me' ? { id: 'return-owner', name: 'Return test' }
      : path.endsWith('/accounts') ? { accounts: connected ? [{ account: 'personal', email: 'me@example.test' }] : [] }
      : { inbox: 1 };
    return route.fulfill({ json });
  });
  await page.goto('/?gmail=cancelled');
  await expect(page.getByText('Connection cancelled. Nothing changed.')).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await page.getByRole('button', { name: 'Mail', exact: true }).first().click();
  await expect(page.getByText('Connection cancelled. Nothing changed.')).toHaveCount(0);
});

// Seam: a native return must refresh the already-open view, including an existing account's new grant.
for (const integration of ['gmail', 'calendar'] as const) test(`${integration} refreshes immediately on app return`, async ({ page, context }) => {
  let connected = false, version = 1, holdNext = false;
  let release!: () => void, began!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const started = new Promise<void>((resolve) => { began = resolve; });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === `/api/${integration}/accounts` && holdNext) {
      holdNext = false; began(); await held;
      return route.fulfill({ json: { accounts: [] } });
    }
    let json: unknown = {};
    if (path === '/api/config') json = { ready: true, allowed: true, providers: [] };
    else if (path === '/api/me') json = { id: 'return-owner', name: 'Return test' };
    else if (path.endsWith('/accounts')) json = { accounts: connected ? [{ account: 'personal', email: 'me@example.test' }] : [] };
    else if (path.endsWith('/connect')) json = { url: 'https://accounts.google.com/o/oauth2/v2/auth?state=fixture' };
    else if (path.endsWith('/counts')) json = { inbox: version };
    else if (path.endsWith('/calendars')) json = { calendars: [{ id: 'primary', summary: 'Life', accessRole: 'owner' }] };
    else if (path.endsWith('/events')) json = { events: [{ id: 'one', summary: `Appointment ${version}`, start: { dateTime: new Date().toISOString() }, end: { dateTime: new Date(Date.now() + 3600000).toISOString() } }] };
    await route.fulfill({ json });
  });
  await context.route('https://accounts.google.com/**', (route) => route.fulfill({ body: 'Google consent fixture' }));
  await page.goto('/');
  await page.getByRole('button', { name: integration === 'gmail' ? 'Mail' : 'Calendar', exact: true }).first().click();
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: integration === 'gmail' ? 'Connect Gmail' : 'Connect Google Calendar', exact: true }).click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(/accounts\.google\.com/);
  connected = true;
  await popup.close();
  const complete = async (result = 'connected') => page.evaluate(async ({ integration, result }) => {
    const { acceptAccountReturn } = await import('/src/lib/' + 'account-return.ts');
    const id = crypto.randomUUID(), app = 'leadinglight-dev-cb7069';
    localStorage.setItem(`leadinglight.connection:${integration}`, JSON.stringify({ app, id, owner: 'return-owner', until: Date.now() + 600000 }));
    return acceptAccountReturn(`${app}://connected/${integration}?result=${result}&id=${id}`)?.result;
  }, { integration, result });
  expect(await complete()).toBe('connected');
  if (integration === 'gmail') {
    await expect(page.getByRole('heading', { name: 'Start fresh' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add another account' })).toBeVisible();
    await expect(page.getByText('me@example.test · 1 waiting')).toBeVisible();
  } else await expect(page.getByRole('button', { name: 'Appointment 1', exact: true })).toBeVisible();
  holdNext = true;
  await page.evaluate(() => window.dispatchEvent(new Event('leadinglight:app-focus')));
  await started;
  version = 2;
  expect(await complete()).toBe('connected');
  await expect(integration === 'gmail' ? page.getByText('me@example.test · 2 waiting') : page.getByRole('button', { name: 'Appointment 2', exact: true })).toBeVisible();
  const stale = page.waitForResponse((r) => r.url().endsWith(`/api/${integration}/accounts`));
  release(); await stale;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(integration === 'gmail' ? page.getByText('me@example.test · 2 waiting') : page.getByRole('button', { name: 'Appointment 2', exact: true })).toBeVisible();
  version = 3;
  await page.evaluate(() => window.dispatchEvent(new Event('leadinglight:app-focus')));
  await expect(integration === 'gmail' ? page.getByText('me@example.test · 3 waiting') : page.getByRole('button', { name: 'Appointment 3', exact: true })).toBeVisible();
  if (integration === 'calendar') {
    await page.getByRole('button', { name: 'Calendars', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Life', exact: true }).uncheck();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
  }
  expect(await complete('cancelled')).toBe('cancelled');
  await expect(page.getByText(/Connection cancelled/)).toBeVisible();
  await page.getByRole('button', { name: 'Today', exact: true }).first().click();
  await page.getByRole('button', { name: integration === 'gmail' ? 'Mail' : 'Calendar', exact: true }).first().click();
  await expect(page.getByText(/Connection cancelled/)).toHaveCount(0);
  await expect(page.getByText('Google connected.', { exact: true })).toHaveCount(0);
});

// Seam: browser handoff is restricted to the app schemes, while the app rejects stale or foreign requests.
test('return links reject unrelated requests and provide a safe browser fallback', async ({ page }) => {
  await page.route('**/api/**', (route) => route.fulfill({ json: { accounts: [] } }));
  await page.goto('/connect/complete?integration=gmail&result=connected&app=leadinglight-dev-0e0e0e&id=00000000-0000-4000-8000-000000000001');
  await expect(page.getByText('Mail connected', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open LeadingLight' })).toHaveAttribute('href', 'leadinglight-dev-0e0e0e://connected/gmail?result=connected&id=00000000-0000-4000-8000-000000000001');
  await page.goto('/connect/complete?integration=calendar&result=cancelled&app=leadinglight-dev-0e0e0e&id=00000000-0000-4000-8000-000000000001');
  await expect(page.getByText('Connection cancelled', { exact: true })).toBeVisible();
  await page.goto('/connect/complete?integration=gmail&result=connected&app=leadinglight&id=------------------------------------');
  await expect(page.getByText('This return link is invalid')).toBeVisible();
  await page.goto('/connect/complete?integration=gmail&result=connected&app=javascript:alert(1)&id=00000000-0000-4000-8000-000000000001');
  await expect(page.getByText('This return link is invalid')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open LeadingLight' })).toHaveCount(0);
  expect(await page.evaluate(async () => {
    const { acceptAccountReturn } = await import('/src/lib/' + 'account-return.ts');
    const { setCloud } = await import('/src/lib/' + 'cloud.ts');
    setCloud({ initialized: true, user: { id: 'alice', name: 'Alice' } });
    const id = crypto.randomUUID(), key = 'leadinglight.connection:gmail';
    const pending = { app: 'leadinglight', id, owner: 'alice', until: Date.now() + 600000 };
    const url = `leadinglight://connected/gmail?result=connected&id=${id}`;
    const check = (patch: object, link = url) => { localStorage.setItem(key, JSON.stringify({ ...pending, ...patch })); return acceptAccountReturn(link); };
    return [check({ owner: 'bob' }), check({ until: 1 }), check({ id: crypto.randomUUID() }), check({}, url.replace('leadinglight:', 'https:')), check({}, `${url}&code=secret`), !!check({}), acceptAccountReturn(url)];
  })).toEqual([null, null, null, null, null, true, null]);
});

// Seam: Tauri can deliver a cold-start URL before the workspace sign-in has loaded.
test('native bridge queues startup returns and receives later URLs and focus', async ({ page }) => {
  await page.route('**/native-return-harness', (route) => route.fulfill({ contentType: 'text/html', body: '<html></html>' }));
  await page.goto('/native-return-harness');
  await page.evaluate(async () => {
    const { mockIPC, mockWindows } = await import('/node_modules/@tauri-apps/api/' + 'mocks.js');
    const id = crypto.randomUUID(), app = 'leadinglight-dev-cb7069';
    const fixture: any = (window as any).returnFixture = { opened: [], current: 0, focused: 0, id, app };
    mockIPC((command: string) => {
      if (command === 'plugin:app|identifier') return 'com.leadinglight.dev.cb7069';
      if (command === 'native_platform') return 'macos';
      if (command === 'plugin:deep-link|get_current') { fixture.current++; return [`${app}://connected/calendar?result=connected&id=${id}`]; }
    }, { shouldMockEvents: true });
    mockWindows('main');
    localStorage.setItem('leadinglight.connection:calendar', JSON.stringify({ app, id, owner: 'alice', until: Date.now() + 600000 }));
    const { watchAccountReturns } = await import('/src/lib/' + 'account-return.ts');
    fixture.stop = watchAccountReturns((integration: string) => fixture.opened.push(integration));
    window.addEventListener('leadinglight:app-focus', () => fixture.focused++);
  });
  await expect.poll(() => page.evaluate(() => (window as any).returnFixture.current)).toBe(1);
  expect(await page.evaluate(() => (window as any).returnFixture.opened)).toEqual([]);
  await page.evaluate(async () => {
    const { setCloud } = await import('/src/lib/' + 'cloud.ts');
    const { emit } = await import('/node_modules/@tauri-apps/api/' + 'event.js');
    const f = (window as any).returnFixture, id = crypto.randomUUID();
    localStorage.setItem('leadinglight.connection:gmail', JSON.stringify({ app: f.app, id, owner: 'alice', until: Date.now() + 600000 }));
    await emit('deep-link://new-url', [`${f.app}://connected/gmail?result=cancelled&id=${id}`]);
    setCloud({ initialized: true, user: { id: 'alice', name: 'Alice' } });
    const { accountReturnRequest } = await import('/src/lib/' + 'account-return.ts');
    const request = await accountReturnRequest('calendar');
    f.request = { ...request, pending: JSON.parse(localStorage.getItem('leadinglight.connection:calendar')!) };
    await emit('deep-link://new-url', [`${request.app}://connected/calendar?result=connected&id=${request.id}`]);
    await emit('tauri://focus', true);
  });
  await expect.poll(() => page.evaluate(() => (window as any).returnFixture.opened)).toEqual(['calendar', 'gmail', 'calendar']);
  expect(await page.evaluate(() => (window as any).returnFixture.request)).toMatchObject({ app: 'leadinglight-dev-cb7069', pending: { app: 'leadinglight-dev-cb7069', owner: 'alice' } });
  await expect.poll(() => page.evaluate(() => (window as any).returnFixture.focused)).toBe(1);
  await page.evaluate(() => (window as any).returnFixture.stop());
});
