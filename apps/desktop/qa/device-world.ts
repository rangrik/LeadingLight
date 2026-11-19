import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import type { Browser, BrowserContext, Page, Route } from '@playwright/test';

// A loopback stand-in for the two native apps. The cloud is the real one (device-server.mjs); only the
// Tauri commands are faked: cloud_request (a bearer token, no cookie, no Origin) and the Mac runtime.
export const CLOUD = `http://127.0.0.1:${process.env.CLOUD_PORT || 18788}`;
export const PORT = process.env.QA_PORT || 14210;
export const PROJECT = 'qa-garden', LOCATION = 'p-qagarden';
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
const seal = (v: unknown) => ({ v: 2, iv: randomBytes(12).toString('base64'), data: b64(v) });
const open = (e: { data: string }) => JSON.parse(Buffer.from(e.data, 'base64').toString());
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
export type Reply = { status: number; body: any };
export const call = async (token: string, path: string, body?: object, method = body ? 'POST' : 'GET'): Promise<Reply> => {
  const r = await fetch(`${CLOUD}/api/${path}`, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
};
export type Account = { owner: string; key: string };
export const account = (): Account => ({ owner: `qa-dev-${randomUUID()}`, key: randomBytes(32).toString('base64') });

export type Session = { token: string; id: string; name: string };
// The real sign-in: start, approval in the account's browser, poll. `keyless` is a device with no library key yet.
export async function signIn(owner: string, name: string, keyless = false): Promise<Session> {
  const verifier = randomBytes(32).toString('base64url');
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const post = (path: string, body: object, headers = {}) => fetch(`${CLOUD}/api/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  const { id } = await (await post('native/start', { challenge: sha(verifier), deviceName: name, signinOnly: keyless, publicKey })).json();
  const approval = keyless ? { id, signinOnly: true } : { id, keyEnvelope: { publicKey, iv: randomBytes(12).toString('base64'), data: randomBytes(32).toString('base64') } };
  await post('native/approve', approval, { Origin: CLOUD, Cookie: `qa-user=${owner}` });
  const { token } = await (await post('native/poll', { id, verifier })).json();
  const { body } = await call(token, 'devices');
  return { token, name, id: body.devices.find((d: any) => d.current).id };
}

type Grant = { relay: { channel: string; hostToken: string; clientToken: string }; stop: AbortController; macName: string };
// What the Mac's runtime holds: its project folder, its review list, and the relay it serves.
export class MacRuntime {
  grants = new Map<string, Grant>();
  reviews: any[] = [];
  accepted: string[] = [];
  constructor(readonly name: string) {}
  private async serve(g: Grant) {
    const hdr = { 'content-type': 'application/json', authorization: `Bearer ${g.relay.hostToken}` };
    const relay = (path: string, body: object, signal?: AbortSignal) => fetch(`${CLOUD}/api/mobile-relay/${path}`, { method: 'POST', headers: hdr, body: JSON.stringify({ channel: g.relay.channel, ...body }), signal });
    while (!g.stop.signal.aborted) {
      const r = await relay('native/poll', {}, g.stop.signal).catch(() => null);
      if (!r) return;
      if (r.status !== 200) return;
      for (const m of (await r.json()).messages) {
        const q = open(m.envelope);
        const hit = q.path === `/v1/locations/${LOCATION}/reviews` && q.method === 'GET';
        const accept = /\/reviews\/([^/]+)\/accept$/.exec(q.path);
        if (accept) this.accepted.push(accept[1]);
        await relay('native/result', { id: m.id, envelope: seal({ status: hit || accept ? 200 : 403, body: hit ? this.reviews : {} }) });
      }
    }
  }
  runtime(route: Route) {
    const req = route.request(), path = new URL(req.url()).pathname.replace('/__runtime', '');
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/v1/locations') return json([{ name: LOCATION, path: '/Users/qa/Garden', folder_id: 'folder-garden' }]);
    if (path === '/status') return json({ state: 'ready', home: '' });
    const link = /^\/v1\/mobile\/links\/([^/]+)$/.exec(path);
    if (link && req.method() === 'PUT') {
      const body = req.postDataJSON(), code = `llmac:${link[1]}`;
      if (body.project !== LOCATION) return json({ error: 'Unknown project folder.' }, 404);
      const g = { relay: body.relay, stop: new AbortController(), macName: this.name };
      this.grants.set(code, g); void this.serve(g);
      return json({ code });
    }
    if (link && req.method() === 'DELETE') { this.grants.forEach((g, c) => c.endsWith(link[1]) && g.stop.abort()); return json({}); }
    if (path.startsWith('/v1/mobile/review-actions/')) return json([]);
    if (path === '/v1/events') return route.fulfill({ status: 200, body: '' });
    return json({ error: `Unused fixture route ${path}` }, 404);
  }
  end() { this.grants.forEach((g) => g.stop.abort()); }
}

const opened: { context: BrowserContext; mac: MacRuntime; page?: Page; out?: string }[] = [];
// Closing a context is what writes its video; a failed test must still leave both files.
export async function closeAll() {
  for (const o of opened.splice(0)) {
    o.mac.end(); await o.context.close().catch(() => {});
    if (o.out) await o.page?.video()?.saveAs(o.out).catch(() => {});
  }
}
export type Ledger = { block: boolean; blocked: number };
export type Device = { page: Page; context: BrowserContext; ledger: Ledger; session: Session };
type Options = { phone?: boolean; key?: string; account: Account; session: Session; mac: MacRuntime; videos?: string };
// One native app: its own storage, its own token, and a ledger of the sync uploads the test held back.
export async function openDevice(browser: Browser, { phone, key, account, session, mac, videos }: Options): Promise<Device> {
  const size = phone ? { width: 390, height: 844 } : { width: 1000, height: 844 };
  // `videos` is a file prefix: <prefix>-mac.webm or <prefix>-phone.webm is written when the test ends.
  const context = await browser.newContext({ viewport: size, ...(phone ? { isMobile: true, hasTouch: true } : {}), ...(videos ? { recordVideo: { dir: tmpdir(), size } } : {}) });
  const entry: (typeof opened)[number] = { context, mac, out: videos && `${videos}-${phone ? 'phone' : 'mac'}.webm` };
  opened.push(entry);
  const ledger: Ledger = { block: false, blocked: 0 };
  const origin = `http://127.0.0.1:${PORT}`;
  const client: { grant?: Grant } = {};
  await context.route(/^(?:https?|wss?):\/\//, (route) => (new URL(route.request().url()).origin === origin ? route.continue() : route.abort()));
  await context.route('**/api/**', async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (req.method() === 'POST' && /^\/api\/sync(?:-part)?$/.test(url.pathname) && ledger.block) { ledger.blocked++; return route.fulfill({ status: 503, json: { error: 'Uploads are blocked in this test.' } }); }
    const headers: Record<string, string> = { authorization: `Bearer ${session.token}` };
    for (const h of ['content-type', 'x-leadinglight-owner']) if (req.headers()[h]) headers[h] = req.headers()[h];
    const r = await fetch(CLOUD + url.pathname + url.search, { method: req.method(), headers, body: req.postData() ?? undefined });
    return route.fulfill({ status: r.status, headers: { 'content-type': r.headers.get('content-type') ?? 'application/json' }, body: Buffer.from(await r.arrayBuffer()) });
  });
  await context.route('**/__runtime/**', (route) => (phone ? route.fulfill({ status: 503, json: { error: 'The phone must not use a local runtime.' } }) : mac.runtime(route)));
  await context.route('**/__mobile/**', async (route) => {
    const action = new URL(route.request().url()).pathname.split('/').at(-1), args = route.request().postDataJSON();
    const state = () => ({ connection: client.grant ? { id: client.grant.relay.channel, name: client.grant.macName, url: 'https://relay.invalid' } : null, online: !!client.grant });
    if (action === 'status') return route.fulfill({ json: state() });
    if (action === 'disconnect') { client.grant = undefined; return route.fulfill({ json: null }); }
    if (action === 'connect') { client.grant = mac.grants.get(args.code); return client.grant ? route.fulfill({ json: state() }) : route.fulfill({ status: 404, json: { error: 'No such connection.' } }); }
    const g = client.grant, hdr = { 'content-type': 'application/json', authorization: `Bearer ${g?.relay.clientToken}` };
    const relay = (path: string, body: object) => fetch(`${CLOUD}/api/mobile-relay/${path}`, { method: 'POST', headers: hdr, body: JSON.stringify({ channel: g?.relay.channel, ...body }) });
    if (!g) return route.fulfill({ status: 403, json: { error: 'Not connected.' } });
    const id = randomUUID(), sent = await relay('native/send', { id, envelope: seal({ method: args.method, path: args.path }) });
    if (!sent.ok) return route.fulfill({ status: sent.status, json: await sent.json() });
    for (let i = 0; i < 60; i++) {
      const r = await relay('native/reply', { id }), j = await r.json();
      if (!r.ok) return route.fulfill({ status: r.status, json: j });
      if (j.envelope) return route.fulfill({ json: open(j.envelope) });
      await wait(250);
    }
    return route.fulfill({ status: 504, json: { error: 'The Mac did not answer.' } });
  });
  await context.addInitScript(({ owner, key }) => {
    // Vite serves a file edited since it started as /x.ts?t=N; only that URL is the app's own copy of the module.
    performance.setResourceTimingBufferSize(10_000);
    (window as any).__qaImport = (path: string) => import(performance.getEntriesByType('resource').find((e) => new URL(e.name).pathname === path)?.name ?? path);
    if (key) { localStorage.setItem('leadinglight.sync-owner', owner); localStorage.setItem(`leadinglight.sync-key:${owner}`, key); localStorage.setItem(`leadinglight.key-saved:${owner}`, 'true'); }
  }, { owner: account.owner, key });
  const page = entry.page = await context.newPage();
  await page.goto(phone ? '/?iphone' : '/');
  return { page, context, ledger, session };
}

// Dummy notes on the Mac: a project with a linked folder, synced for real before the test holds uploads.
export async function seedProject(mac: Page) {
  await mac.evaluate(async ({ id, location }) => {
    const load = (window as any).__qaImport;
    const { createPage } = await load('/src/lib/space.ts');
    const { objects } = await load('/src/lib/objects.ts');
    const project = await createPage({ id, title: 'Garden research', typeId: 'project' });
    await objects.putFolder({ pageId: project.id, path: '/Users/qa/Garden', folderId: 'folder-garden', location, createdAt: 1, updatedAt: 1 });
    const { syncNow } = await load('/src/lib/sync.ts');
    await syncNow();
  }, { id: PROJECT, location: LOCATION });
  // The app reads its project folders once at start, as it does for a Mac that already has projects.
  await mac.reload();
}

// The same project page on a phone that has no key yet, so the project row can be tried without notes.
export const seedLocalProject = (phone: Page) => phone.evaluate(async (id) => {
  const { createPage } = await (window as any).__qaImport('/src/lib/space.ts');
  await createPage({ id, title: 'Garden research', typeId: 'project' });
}, PROJECT);

export const dummyReview = { task: 'task-1', title: 'Plan the vegetable beds', report: 'report-1', reportTitle: 'Bed layout and planting dates', text: 'Tomatoes go on the south wall.\nBeans follow the peas.' };
