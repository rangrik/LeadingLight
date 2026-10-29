import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type BrowserContext } from '@playwright/test';

const origin = `http://127.0.0.1:${process.env.QA_PORT || 1431}`;
const api = `http://127.0.0.1:${process.env.CLOUD_PORT || 8787}/api`;
const owner = () => `qa-native-${crypto.randomUUID()}`;
const account = (context: BrowserContext, id: string) => context.addCookies([{ name: 'qa-user', value: id, url: origin }]);
const post = (path: string, body: object, headers: Record<string, string> = {}) => fetch(`${api}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
const keyName = (id: string) => `leadinglight.sync-key:${id}`;
async function device() {
  const verifier = randomBytes(32).toString('base64url');
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
  const response = await post('native/start', { challenge: createHash('sha256').update(verifier).digest('hex'), deviceName: 'QA iPad', publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey) });
  expect(response.status).toBe(201);
  const started = await response.json() as { id: string; approvalUrl: string };
  return { ...started, verifier, pair, poll: () => post('native/poll', { id: started.id, verifier }) };
}

test.beforeEach(async ({ context }) => {
  test.skip(!process.env.CLOUD_QA, 'Requires isolated browser-server and PostgreSQL.');
  await context.route(/^(?:https?|wss?):\/\//, (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
});

// Seam: real browser approval and backend storage must hand the key only to the requesting device.
test('browser approval hands the existing recovery key to exactly one native requester', async ({ page, context }) => {
  const id = owner(), recovery = randomBytes(32).toString('base64'), request = await device();
  await account(context, id);
  await context.addInitScript(({ id, recovery }) => {
    localStorage.setItem('leadinglight.sync-owner', id);
    localStorage.setItem(`leadinglight.sync-key:${id}`, recovery);
    localStorage.setItem(`leadinglight.sync-paused:${id}`, 'true');
  }, { id, recovery });
  await page.goto(request.approvalUrl);
  const dialog = page.getByRole('dialog', { name: 'Connect your device' });
  await expect(dialog).toContainText('QA iPad will connect to QA account');
  await expect(dialog).toContainText(request.id.replaceAll('-', '').slice(0, 8).toUpperCase());
  expect((await (await request.poll()).json()).status).toBe('pending');
  await dialog.getByRole('button', { name: 'Connect this device', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Device approved' })).toBeVisible();
  const approved = await (await request.poll()).json();
  expect(approved.status).toBe('approved');
  expect(approved.user.id).toBe(id);
  const peer = await crypto.subtle.importKey('jwk', approved.keyEnvelope.publicKey, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const secret = await crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, request.pair.privateKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(approved.keyEnvelope.iv, 'base64'), additionalData: new TextEncoder().encode(`leadinglight-native:${request.id}:${id}`) }, secret, Buffer.from(approved.keyEnvelope.data, 'base64'));
  expect(new TextDecoder().decode(plain)).toBe(recovery);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(approved.token);
  expect((await request.poll()).status).toBe(410);
  const session = { Authorization: `Bearer ${approved.token}` };
  try {
    expect((await (await fetch(`${api}/me`, { headers: session })).json()).id).toBe(id);
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('already approved');
    await expect(page.getByRole('button', { name: 'Connect this device', exact: true })).toBeDisabled();
  } finally { expect((await post('native/revoke', {}, session)).ok).toBe(true); }
});

// Seam: changing the browser account must not give away or replace another workspace's key.
test('approval in another account preserves the original recovery key', async ({ page, context }) => {
  const original = owner(), other = owner(), recovery = randomBytes(32).toString('base64'), request = await device();
  await account(context, other);
  await context.addInitScript(({ original, recovery }) => {
    localStorage.setItem('leadinglight.sync-owner', original);
    localStorage.setItem(`leadinglight.sync-key:${original}`, recovery);
  }, { original, recovery });
  await page.goto(request.approvalUrl);
  await page.getByRole('button', { name: 'Connect this device', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('linked to another account');
  expect(await page.evaluate((key) => localStorage.getItem(key), keyName(original))).toBe(recovery);
  expect(await page.evaluate((key) => localStorage.getItem(key), keyName(other))).toBeNull();
  expect((await (await request.poll()).json()).status).toBe('pending');
});

test('an account change during approval leaves the request pending', async ({ page, context }) => {
  const id = owner(), recovery = randomBytes(32).toString('base64'), request = await device();
  await account(context, id);
  await context.addInitScript(({ id, recovery }) => {
    localStorage.setItem('leadinglight.sync-owner', id);
    localStorage.setItem(`leadinglight.sync-key:${id}`, recovery);
    localStorage.setItem(`leadinglight.sync-paused:${id}`, 'true');
  }, { id, recovery });
  await page.goto(request.approvalUrl);
  const approve = page.getByRole('button', { name: 'Connect this device', exact: true });
  await expect(approve).toBeEnabled();
  await account(context, owner());
  await approve.click();
  await expect(page.getByRole('alert')).toContainText('account changed');
  expect((await (await request.poll()).json()).status).toBe('pending');
  expect(await page.evaluate((name) => localStorage.getItem(name), keyName(id))).toBe(recovery);
});

// Seam: provisioning a new browser key must be undone if another approver won the request.
test('an already-approved request does not bind a browser or keep a generated key', async ({ page, context }) => {
  const id = owner(), request = await device();
  await account(context, id);
  await page.goto(request.approvalUrl);
  const approve = page.getByRole('button', { name: 'Connect this device', exact: true });
  await expect(approve).toBeEnabled();
  const consumed = await post('native/approve', { id: request.id, keyEnvelope: { publicKey: await crypto.subtle.exportKey('jwk', request.pair.publicKey), iv: randomBytes(12).toString('base64'), data: randomBytes(32).toString('base64') } }, { Origin: origin, Cookie: `qa-user=${id}` });
  expect(consumed.status).toBe(200);
  let uploads = 0;
  page.on('request', (req) => { if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/sync') uploads++; });
  await approve.click();
  await expect(page.getByRole('alert')).toContainText('already approved');
  expect(await page.evaluate((id) => ['leadinglight.sync-owner', `leadinglight.sync-key:${id}`, `leadinglight.sync-key:${id}:previous`, `leadinglight.sync-paused:${id}`].map((key) => localStorage.getItem(key)), id)).toEqual([null, null, null, null]);
  expect(uploads).toBe(0);
});

test('sign-in is required and invalid approval links show an error', async ({ page, context }) => {
  const request = await device();
  await page.goto(request.approvalUrl);
  await expect(page.getByRole('dialog', { name: 'Connect your device' })).toContainText('Sign in with the same provider');
  await expect(page.getByRole('button', { name: 'Connect this device', exact: true })).toHaveCount(0);
  expect((await (await request.poll()).json()).status).toBe('pending');
  await account(context, owner());
  await page.goto('/?connect=invalid');
  await expect(page.getByRole('alert')).toContainText('Invalid connection');
  await expect(page.getByRole('button', { name: 'Connect this device', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Connect your device' })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has('connect')).toBe(false);
});

test('iPad account settings fit a narrow window and omit agent controls', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/?ipad');
  await page.getByRole('button', { name: 'Toggle Sidebar', exact: true }).click();
  await page.getByRole('button', { name: 'Account and sync', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Your workspace, everywhere' });
  await expect(dialog).toBeVisible();
  await expect(page.locator('[data-slot="sidebar"][data-mobile]')).toBeHidden();
  await expect(dialog.getByRole('tab', { name: 'Agents', exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Connect your workspace', exact: true })).toBeEnabled();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: `qa/report/native-account-ipad-${test.info().project.name}.png`, animations: 'disabled' });
});

// Seam: a native credential write failure must roll back key changes before sync can upload.
test('failed native confirmation restores the previous workspace and paused state', async ({ page }) => {
  await page.route('**/src/main.tsx*', (route) => route.fulfill({ contentType: 'text/javascript', body: 'export {};' }));
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const id = crypto.randomUUID(), owner = `qa-confirm-${crypto.randomUUID()}`, user = { id: owner, name: 'Prior account' };
    const b64 = (data: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(data)));
    const next = b64(crypto.getRandomValues(new Uint8Array(32))), previous = b64(crypto.getRandomValues(new Uint8Array(32)));
    const snapshot = { 'leadinglight.sync-owner': owner, [`leadinglight.sync-key:${owner}`]: previous, [`leadinglight.sync-key:${owner}:previous`]: 'older key', [`leadinglight.sync-paused:${owner}`]: 'true' };
    for (const [name, value] of Object.entries(snapshot)) localStorage.setItem(name, value);
    let publicKey: JsonWebKey, aborted = 0, confirmed = false, keyWasChanged = false, uploads = 0;
    Object.assign(window, { __TAURI_INTERNALS__: { invoke: async (command: string, args: { path?: string; body?: { publicKey: JsonWebKey }; method?: string }) => {
      if (command === 'plugin:app|identifier') return 'com.leadinglight.dev.qa';
      if (command === 'native_platform') return 'ios';
      if (command === 'plugin:opener|open_url') return null;
      if (command !== 'cloud_request') throw new Error(`Unexpected native call: ${command}`);
      let body: unknown;
      if (args.path === 'native/start') { publicKey = args.body!.publicKey; body = { id, expiresAt: new Date(Date.now() + 600000).toISOString(), approvalUrl: `https://leadinglight-web.vercel.app/?connect=${id}` }; }
      else if (args.path === 'native/poll') {
        const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveKey']);
        const peer = await crypto.subtle.importKey('jwk', publicKey!, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
        const key = await crypto.subtle.deriveKey({ name: 'ECDH', public: peer }, pair.privateKey, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12)), data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`leadinglight-native:${id}:${owner}`) }, key, new TextEncoder().encode(next));
        body = { status: 'approved', user, keyEnvelope: { publicKey: await crypto.subtle.exportKey('jwk', pair.publicKey), iv: b64(iv), data: b64(data) } };
      } else if (args.path === 'sync?after=0') {
        const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(next), (c) => c.charCodeAt(0)), 'AES-GCM', false, ['encrypt']);
        const iv = crypto.getRandomValues(new Uint8Array(12)), data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(`${owner}:fixture`) }, key, new TextEncoder().encode('{}'));
        body = { events: [{ id: 'fixture', envelope: { v: 1, iv: b64(iv), data: b64(data) } }] };
      } else if (args.path === 'native/confirm') {
        confirmed = true; keyWasChanged = localStorage.getItem(`leadinglight.sync-key:${owner}`) === next;
        const path = '/src/lib/sync.ts'; await (await import(/* @vite-ignore */ path)).syncNow();
        throw new Error('Keychain could not save your cloud connection.');
      } else if (args.path === 'native/abort') { aborted++; body = { ok: true }; }
      else if (args.path === 'config') body = { ready: true, allowed: true, providers: [] };
      else if (args.path === 'me') body = user;
      else { if (args.path === 'sync' && args.method === 'POST') uploads++; throw new Error(`Unexpected cloud call: ${args.path}`); }
      return { status: 200, body };
    } } });
    const path = '/src/lib/native-account.ts', cloudPath = '/src/lib/cloud.ts';
    const native = await import(/* @vite-ignore */ path), cloud = await import(/* @vite-ignore */ cloudPath);
    cloud.setCloud({ user });
    let error = ''; try { await native.connectNativeAccount(); } catch (e) { error = String(e); }
    return { error, confirmed, keyWasChanged, aborted: aborted > 0, uploads, restored: Object.entries(snapshot).every(([key, value]) => localStorage.getItem(key) === value), priorAccount: cloud.cloudState().user?.id === owner, verifying: cloud.cloudState().verifying, pending: native.nativeConnection.get().pending };
  });
  expect(result).toEqual({ error: 'Error: Keychain could not save your cloud connection.', confirmed: true, keyWasChanged: true, aborted: true, uploads: 0, restored: true, priorAccount: true, verifying: false, pending: false });
});
