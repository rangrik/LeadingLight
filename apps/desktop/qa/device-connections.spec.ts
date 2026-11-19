import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { expect, test, type Browser } from '@playwright/test';
import { account, call, CLOUD, closeAll, PORT, dummyReview, MacRuntime, openDevice, PROJECT, seedLocalProject, seedProject, signIn, type Device } from './device-world';

const evidence = process.env.DEVICE_QA_EVIDENCE || '/tmp/ll-device-qa-evidence';
// Skipped unless qa/device-server.mjs is up (isolated PostgreSQL); the app is the Vite server on QA_PORT (default 14210).
const fixtureUp = await fetch(`${CLOUD}/api/config`).then((r) => r.ok, () => false);
test.skip(!fixtureUp, 'Requires qa/device-server.mjs and the isolated PostgreSQL.');
test.use({ baseURL: `http://127.0.0.1:${PORT}` });
test.setTimeout(150_000);
test.beforeAll(async () => { await mkdir(evidence,{recursive:true}); });
test.afterEach(closeAll);

async function world(browser: Browser, videos?: string) {
  const acct = account(), mac = new MacRuntime('QA Mac');
  mac.reviews = [dummyReview];
  const macApp = await openDevice(browser, { account: acct, session: await signIn(acct.owner, 'QA Mac'), key: acct.key, mac, videos });
  await expect(macApp.page.getByRole('button', { name: 'Search library', exact: true })).toBeEnabled();
  await seedProject(macApp.page);
  // Only once notes exist does the cloud hold a keyless device back, as it does for a real new phone.
  await expect.poll(async () => (await call(macApp.session.token, 'sync?after=0')).body.events.length, { timeout: 30_000 }).toBeGreaterThan(0);
  const phone = async (name = 'QA iPhone') => openDevice(browser, { phone: true, account: acct, session: await signIn(acct.owner, name, true), mac, videos });
  return { acct, mac, macApp, phone };
}
// Toasts are dialogs too, so a dialog is found by its title.
const dialog = (d: Device, name: RegExp | string = /wants to connect|Look at|Set up note sync|Connect to a project Mac|Plan the vegetable beds/) => d.page.getByRole('dialog', { name });
const phoneNumber = (d: Device) => dialog(d).locator('p.text-5xl');
const numbers = (d: Device) => dialog(d).getByRole('button', { name: /^\d{2}$/ });
const pick = (mac: Device, n: number) => numbers(mac).filter({ hasText: new RegExp(`^${n}$`) }).click();
const keyOf = (d: Device, owner: string) => d.page.evaluate((k) => localStorage.getItem(k), `leadinglight.sync-key:${owner}`);
// The pause lets the 200 ms dialog animation finish and gives the video a moment to read.
const shot = (d: Device, name: string) => d.page.waitForTimeout(1200).then(() => d.page.screenshot({ path: `${evidence}/${name}.png` }));
const junk = { iv: 'AAAAAAAAAAAAAAAA', data: 'A'.repeat(24) };
const links = async (d: Device) => (await call(d.session.token, 'device-links/list', {})).body.links as { id: string; state: string; project: string | null }[];
const syncStatus = async (d: Device) => (await call(d.session.token, 'sync?after=0')).status;

async function openSyncPicker(d: Device) {
  const notes = d.page.getByRole('navigation', {name:'Phone navigation'}).getByRole('button', {name:'Notes',exact:true});
  await notes.click();
  await d.page.getByRole('button', {name:/^Account and sync/}).click();
  await d.page.getByRole('button', {name:'Connect a device',exact:true}).click();
}
async function openProject(d: Device) {
  const settings=d.page.locator('.ll-settings');
  if(await settings.isVisible()){
    await settings.getByRole('button',{name:'Toggle sidebar'}).first().click();
    await d.page.getByRole('button',{name:/Back to app/}).click();
  }
  await d.page.getByRole('navigation', { name: 'Phone navigation' }).getByRole('button', { name: 'Notes', exact: true }).click();
  await d.page.getByText('Garden research', { exact: true }).first().click({ timeout: 30_000 });
  return d.page.getByRole('region', { name: 'Project connection' });
}
const firstCountdown: number[] = [];
// The phone asks and shows its number; the Mac shows the request. Returns the phone's number.
async function ask(phone: Device, mac: Device) {
  await dialog(phone).getByRole('button', { name: 'Request', description: 'Available' }).click();
  await expect(phoneNumber(phone)).toBeVisible({ timeout: 20_000 });
  await expect(dialog(mac)).toContainText('wants to connect', { timeout: 15_000 });
  // The countdown as first drawn: the request lasts 120 s, so a larger number is a stale clock.
  firstCountdown.push(Number(/Expires in (\d+) seconds/.exec(await dialog(mac).innerText())?.[1]));
  return Number(await phoneNumber(phone).innerText());
}

// Seam: one number on the phone and three on the Mac; only the right pick gives the phone notes and project work.
test('a phone reviews a Mac task: notes first, then the project, with uploads held', async ({ browser }) => {
  test.setTimeout(240_000);
  const w = await world(browser, `${evidence}/happy-path`), { acct, mac, macApp } = w, phone = await w.phone();
  expect(await syncStatus(phone)).toBe(403);
  await test.step('notes only: one number on the phone, three choices and Deny on the Mac', async () => {
    await openSyncPicker(phone);
    await expect(dialog(phone)).toContainText('Set up note sync');
    await shot(phone, 'phone-1-picker');
    const shown = await ask(phone, macApp);
    await expect(dialog(macApp)).toContainText('Allow this device to read and change your notes.');
    await expect(numbers(macApp)).toHaveCount(3);
    await expect(dialog(macApp).getByRole('button', { name: 'Deny', exact: true })).toBeVisible();
    expect((await numbers(macApp).allInnerTexts()).map(Number)).toContain(shown);
    await shot(phone, 'phone-2-number'); await shot(macApp, 'mac-1-choices');
    await pick(macApp, shown);
    await expect.poll(() => keyOf(phone, acct.owner), { timeout: 20_000 }).toBe(acct.key);
    expect(mac.grants.size).toBe(0);
    expect(await syncStatus(phone)).toBe(200);
  });
  await test.step('uploads are held from here on', async () => {
    macApp.ledger.block = phone.ledger.block = true;
    await macApp.page.evaluate(async () => {
      const { createPage } = await (window as any).__qaImport('/src/lib/space.ts');
      const { syncNow } = await (window as any).__qaImport('/src/lib/sync.ts');
      await createPage({ title: 'Edited while uploads are held' });
      await syncNow().catch(() => {});
    });
    await expect.poll(() => macApp.ledger.blocked).toBeGreaterThan(0);
  });
  await test.step('the project asks, and the Mac report opens', async () => {
    const section = await openProject(phone);
    await expect(section).toContainText('Connect to the Mac that has this project');
    await shot(phone, 'phone-3-project');
    await section.getByRole('button', { name: 'Connect', exact: true }).click();
    const shown = await ask(phone, macApp);
    await expect(dialog(macApp)).toContainText('run agents in Garden research on this Mac');
    await pick(macApp, shown);
    await expect(section).toContainText('Agents run on this Mac.', { timeout: 30_000 });
    await section.getByRole('button', { name: 'Review', exact: true }).click();
    await expect(dialog(phone)).toContainText('Bed layout and planting dates');
    await expect(dialog(phone)).toContainText('Tomatoes go on the south wall.');
    await shot(phone, 'phone-4-report');
    expect(phone.ledger.blocked + macApp.ledger.blocked).toBeGreaterThan(0);
  });
  await phone.context.close(); await macApp.context.close();

  // Seam: a grant belongs to one pair of devices, one account, one folder, and ends when removed.
  await test.step('bound access: other device, other account, other folder, then removal', async () => {
    const approved = (await links(phone)).filter((l) => l.state === 'approved');
    const notes = approved.find((l) => l.project === null)!, project = approved.find((l) => l.project === PROJECT)!;
    expect(notes && project).toBeTruthy();
    // The notes-only approval can never be turned into project access.
    expect((await call(macApp.session.token, 'device-links/channel', { id: notes.id })).status).toBe(409);
    const stranger = await signIn(acct.owner, 'Stranger iPad', true), foreign = await signIn(account().owner, 'Other Mac');
    for (const who of [stranger, foreign]) for (const op of ['approve', 'channel', 'cancel', 'deny', 'remove']) expect((await call(who.token, `device-links/${op}`, { id: project.id, envelope: junk })).status, `${who.name} ${op}`).toBe(404);
    expect((await call(foreign.token, 'device-links/start', { target: macApp.session.id, project: null })).status).toBe(409);
    expect((await call(phone.session.token, 'device-links/start', { target: macApp.session.id, project: 'other-folder' })).status).toBe(409);
    const g = [...mac.grants.values()][0];
    const relay = (token: string, path: string, channel = g.relay.channel) => fetch(`${CLOUD}/api/mobile-relay/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ channel, id: randomUUID() }) }).then((r) => r.status);
    expect(await relay(g.relay.clientToken, 'native/poll')).toBe(403);
    expect(await relay(g.relay.hostToken, 'native/send')).toBe(403);
    expect(await relay(g.relay.clientToken, 'native/send', randomUUID())).toBe(403);
    expect((await call(phone.session.token, 'device-links/remove', { id: project.id })).status).toBe(200);
    expect(await relay(g.relay.clientToken, 'native/reply')).toBe(403);
    expect(await syncStatus(phone)).toBe(200);
    expect((await call(macApp.session.token, 'device-links/remove', { id: notes.id })).status).toBe(200);
    expect(await syncStatus(phone)).toBe(403);
    expect((await links(macApp)).filter((l) => l.state === 'approved')).toHaveLength(0);
  });
  mac.end();
});

// Seam: a wrong number, Deny and a lapsed request must each leave the phone with nothing, however the Mac is used afterwards.
test('a wrong number, Deny and expiry each end the request without access', async ({ browser }) => {
  const w = await world(browser), { acct, mac, macApp } = w, phone = await w.phone();
  await seedLocalProject(phone.page);
  const section = await openProject(phone);
  for (const ending of ['wrong number', 'Deny', 'expiry']) {
    await section.getByRole('button', { name: 'Connect', exact: true }).click();
    const shown = await ask(phone, macApp);
    if (ending === 'wrong number') await pick(macApp, (await numbers(macApp).allInnerTexts()).map(Number).find((n) => n !== shown)!);
    else if (ending === 'Deny') await dialog(macApp).getByRole('button', { name: 'Deny', exact: true }).click();
    else await fetch(`${CLOUD}/__qa/expire?id=${(await links(macApp)).filter((l) => l.state === 'pending').at(-1)!.id}`);
    await expect(section).toContainText(ending === 'expiry' ? 'Request expired. You can ask again.' : 'Request declined. You can ask again.', { timeout: 20_000 });
    await expect(dialog(macApp)).toHaveCount(0);
    const last = (await links(macApp)).at(-1)!;
    expect(last.state, ending).toBe(ending === 'expiry' ? 'expired' : 'denied');
    expect((await call(macApp.session.token, 'device-links/approve', { id: last.id, envelope: junk })).status, ending).toBe(409);
    expect((await call(macApp.session.token, 'device-links/channel', { id: last.id })).status, ending).toBe(409);
    expect(await syncStatus(phone), ending).toBe(403);
    expect(await keyOf(phone, acct.owner), ending).toBeNull();
    expect(mac.grants.size, ending).toBe(0);
  }
  await shot(phone, 'phone-5-declined');
  expect.soft(Math.max(...firstCountdown), 'Mac countdown at first paint').toBeLessThanOrEqual(121);
});

// Seam: two phones asking one Mac at once must each get only their own approval.
test('overlapping requests: each phone is approved only by its own number', async ({ browser }) => {
  const w = await world(browser), { acct, macApp } = w, [a, b] = [await w.phone('QA iPhone A'), await w.phone('QA iPhone B')];
  await openSyncPicker(a); await openSyncPicker(b);
  const nA = await ask(a, macApp), nB = await ask(b, macApp);
  await expect(dialog(macApp)).toContainText('QA iPhone A wants to connect');
  await shot(macApp, 'mac-2-two-requests');
  await pick(macApp, nA);
  await expect.poll(() => keyOf(a, acct.owner), { timeout: 20_000 }).toBe(acct.key);
  expect(await keyOf(b, acct.owner)).toBeNull();
  expect([await syncStatus(a), await syncStatus(b)]).toEqual([200, 403]);
  await expect(dialog(macApp)).toContainText('QA iPhone B wants to connect', { timeout: 15_000 });
  await pick(macApp, nB);
  await expect.poll(() => keyOf(b, acct.owner), { timeout: 20_000 }).toBe(acct.key);
  await a.context.close(); await b.context.close();
  // One phone asking again withdraws its first request, and a double tap approves once.
  const ask2 = () => call(a.session.token, 'device-links/start', { target: macApp.session.id, project: null });
  expect([(await ask2()).status, (await ask2()).status]).toEqual([200, 200]);
  const [older, newer] = (await links(a)).slice(-2);
  expect([older.state, newer.state]).toEqual(['cancelled', 'pending']);
  const taps = await Promise.all([1, 2].map(() => call(macApp.session.token, 'device-links/approve', { id: newer.id, envelope: junk })));
  expect(taps.map((t) => t.status).sort()).toEqual([200, 409]);
});
