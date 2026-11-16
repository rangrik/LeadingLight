import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gmailRequest, gmailCallback, content } from './gmail.mjs';
import { application } from './app.mjs';
import { nativeRoute } from './native.mjs';
import { database } from './database.mjs';
import { seal } from './calendar.mjs';

const env = { APP_ORIGIN: 'https://notes.test', CLOUD_ACCESS: 'public', GMAIL_CLIENT_ID: 'gmail-test', GMAIL_CLIENT_SECRET: 'test', GMAIL_TOKEN_KEY: randomBytes(32).toString('base64') };
const scope = 'openid email https://www.googleapis.com/auth/gmail.modify';
const part = (mimeType, text, extra = {}) => ({ mimeType, body: { data: Buffer.from(text).toString('base64url'), size: Buffer.byteLength(text) }, ...extra });

// Seam: nested Gmail MIME must remain inert data; attachment text must not become the body.
test('MIME handles nested text, HTML fallback, attachment bodies, charset and size limits', async () => {
  const payload = { parts: [{ parts: [part('text/plain', 'Hello 🌞'), part('text/html', '<b>Hello</b>')] }, part('text/plain', 'private attachment', { filename: 'notes.txt' })] };
  payload.headers = [{ name: 'Subject', value: '=?UTF-8?Q?Caf=C3=A9_?= =?UTF-8?B?8J+Mjg==?=' }, { name: 'Reply-To', value: '"Alex, Team" <replies@example.test>' }];
  const value = await content({ id: 'one', payload }, () => assert.fail());
  assert.equal(value.subject, 'Café 🌎');
  // The reply form shows this address; send() replies to the same header.
  assert.equal(value.replyTo, '"Alex, Team" <replies@example.test>');
  assert.equal(value.text, 'Hello 🌞'); assert.equal(value.html, ''); assert.equal(value.attachments[0].name, 'notes.txt');
  assert.equal((await content({ payload: part('text/html', '<img src="https://tracker.test"><script>bad()</script>') })).text, '');
  assert.equal((await content({ id: 'one', payload: { mimeType: 'text/plain', body: { attachmentId: 'body', size: 5 } } }, async (path) => { assert.equal(path, '/messages/one/attachments/body'); return { data: Buffer.from('Hello').toString('base64url') }; })).text, 'Hello');
  assert.equal((await content({ payload: { mimeType: 'text/plain', headers: [{ name: 'Content-Type', value: 'text/plain; charset=iso-8859-1' }], body: { data: Buffer.from([0xe9]).toString('base64url') } } })).text, 'é');
  await assert.rejects(content({ payload: { mimeType: 'text/plain', body: { size: 3_000_000 } } }), /too large/);
});

// Seam: browser and native callers must not bypass workspace ownership or reach routes beyond the named ones.
test('routes enforce workspace, origin, rollout and the native allowlist', async () => {
  const app = application({ env, sql: () => assert.fail('Unauthorized database access'), auth: { ready: true, providers: [], user: async (r) => r.headers.has('test-user') ? { id: r.headers.get('test-user') } : null } });
  const request = (headers) => new Request(`${env.APP_ORIGIN}/api/gmail/messages`, { method: 'POST', headers, body: '{}' });
  assert.equal((await app(request({ origin: env.APP_ORIGIN }))).status, 401);
  assert.equal((await app(request({ origin: 'https://evil.test', 'test-user': 'alice' }))).status, 403);
  assert.equal((await app(request({ origin: env.APP_ORIGIN, 'test-user': 'alice', 'x-leadinglight-owner': 'bob' }))).status, 409);
  assert.equal(nativeRoute(new Request(`${env.APP_ORIGIN}/api/gmail/accounts`)), true);
  assert.equal((await app(new Request(`${env.APP_ORIGIN}/api/gmail/accounts`, { headers: { authorization: 'Bearer invalid' } }))).status, 401);
  for (const action of ['connect', 'disconnect', 'messages', 'message', 'thread', 'counts', 'modify', 'send']) assert.equal(nativeRoute(new Request(`${env.APP_ORIGIN}/api/gmail/${action}`, { method: 'POST' })), true);
  for (const action of ['callback', 'delete', 'trash']) assert.equal(nativeRoute(new Request(`${env.APP_ORIGIN}/api/gmail/${action}`, { method: 'POST' })), false);
});

// Seam: actual database grants and OAuth state cannot cross users, replay or resurrect a disconnect.
test('OAuth, multi-account reads, search, paging, refresh and disconnect isolation', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const sql = database(process.env.TEST_DATABASE_URL), owner = randomUUID(), other = randomUUID();
  let account = 'personal', granted = scope, expired = false, refreshes = 0, disconnectOnRefresh = false;
  const calls = [];
  const fetcher = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/token')) {
      if (options.body.get('grant_type') === 'refresh_token') {
        if (disconnectOnRefresh) await sql`DELETE FROM gmail_accounts WHERE owner=${owner} AND account=${account}`;
        refreshes++; if (expired) return Response.json({ error: 'invalid_grant' }, { status: 400 }); }
      return Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600, scope: granted });
    }
    if (String(url).endsWith('/userinfo')) return Response.json({ sub: account, email: `${account}@example.test`, email_verified: true });
    if (String(url).includes('/messages?')) return Response.json({ messages: [{ id: 'one' }, { id: 'deleted' }], nextPageToken: 'next' });
    if (String(url).includes('/messages/deleted?')) return Response.json({}, { status: 404 });
    if (String(url).includes('/threads/thread?')) return Response.json({ messages: [mail('Private mail'), mail('First', '1600000000000')] });
    if (String(url).endsWith('/labels/INBOX')) return Response.json({ messagesTotal: 14236 });
    if (options.method === 'POST') return Response.json({ id: 'sent', threadId: 'thread' });
    return Response.json(mail('Private mail'));
  };
  const headers = [['Subject', 'Hello'], ['From', 'Alex <alex@example.test>'], ['Reply-To', '"Alex, Team" <replies@example.test>'], ['Message-ID', '<m1@example.test>'], ['References', '<m0@example.test>'], ['List-Unsubscribe', '<mailto:u@example.test>']];
  const mail = (text, internalDate = '1700000000000') => ({ id: 'one', threadId: 'thread', internalDate, labelIds: ['UNREAD', 'INBOX', 'CATEGORY_UPDATES'], payload: { headers: headers.map(([name, value]) => ({ name, value })), ...part('text/plain', text) } });
  const run = (action, body, user = owner) => gmailRequest({ request: new Request(`${env.APP_ORIGIN}/api/gmail/${action}`, { method: body ? 'POST' : 'GET', ...(body && { body: JSON.stringify(body) }) }), env, sql, user: { id: user }, readBody: (r) => r.json(), fetcher });
  const connect = async (body = {}) => {
    const auth = new URL((await (await run('connect', body)).json()).url);
    assert.equal(auth.searchParams.get('scope'), scope); assert.equal(auth.searchParams.get('code_challenge_method'), 'S256');
    return new Request(`${env.APP_ORIGIN}/api/gmail/callback?code=code&state=${auth.searchParams.get('state')}`);
  };
  const callback = (request, user = owner) => gmailCallback({ request, env, sql, user: { id: user }, fetcher });
  try {
    await sql.unsafe(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    const request = await connect();
    await assert.rejects(callback(request, other), /another workspace/);
    assert.match((await callback(request)).headers.get('location'), /gmail=connected/);
    await assert.rejects(callback(request), /expired/);
    const timeout = await connect();
    await sql`UPDATE gmail_oauth SET expires_at=now()-interval '1 second' WHERE owner=${owner}`;
    await assert.rejects(callback(timeout), /expired/);
    await callback(await connect()); account = 'work'; await callback(await connect());
    assert.equal((await (await run('accounts')).json()).accounts.length, 2);
    assert.equal((await (await run('accounts', undefined, other)).json()).accounts.length, 0);
    await assert.rejects(run('message', { account, id: 'one' }, other), /Connect this Gmail/);
    const cancel = new URL((await connect()).url); cancel.searchParams.set('error', 'access_denied');
    assert.match((await callback(new Request(cancel))).headers.get('location'), /cancelled/);
    // Seam: the callback must return only to the initiating app, with no Google credentials in the link.
    for (const app of ['leadinglight', 'leadinglight-dev-cb7069']) {
      const id = randomUUID(), native = await connect({ app, id }), tampered = new URL(native.url);
      tampered.searchParams.set('app', 'https://evil.test'); tampered.searchParams.set('id', randomUUID());
      const back = new URL((await callback(new Request(tampered))).headers.get('location'));
      assert.equal(back.pathname, '/connect/complete');
      assert.deepEqual(Object.fromEntries(back.searchParams), { integration: 'gmail', result: 'connected', app, id });
      const cancelled = new URL((await connect({ app, id })).url); cancelled.searchParams.set('error', 'access_denied');
      assert.equal(new URL((await callback(new Request(cancelled))).headers.get('location')).searchParams.get('result'), 'cancelled');
      await assert.rejects(callback(native), /expired/);
    }
    await assert.rejects(connect({ app: 'https://evil.test', id: randomUUID() }), /return address/);
    await assert.rejects(connect({ app: 'leadinglight', id: '-'.repeat(36) }), /return address/);
    granted = 'openid email https://www.googleapis.com/auth/gmail.readonly'; await assert.rejects(callback(await connect()), /put away/); granted = scope;
    const page = await (await run('messages', { account: 'personal' })).json();
    assert.equal(page.messages.length, 1); assert.equal(page.messages[0].unread, true); assert.equal(page.nextPageToken, 'next');
    assert.ok(calls.some((c) => c.url.includes('labelIds=INBOX')));
    await run('messages', { account, query: 'from:alex@example.com', pageToken: 'next' });
    const search = calls.find((c) => c.url.includes('pageToken=next')).url;
    assert.equal(new URL(search).searchParams.get('q'), 'from:alex@example.com'); assert.equal(new URL(search).searchParams.has('labelIds'), false);
    assert.equal((await (await run('message', { account, id: 'one' })).json()).message.text, 'Private mail');
    assert.deepEqual([page.messages[0].labels, page.messages[0].unsubscribe], [['UNREAD', 'INBOX', 'CATEGORY_UPDATES'], true]);
    await run('messages', { account, after: 1700000000 });
    assert.equal(new URL(calls.findLast((c) => c.url.includes('/messages?')).url).searchParams.get('q'), 'in:inbox after:1700000000');
    await assert.rejects(run('messages', { account, after: 1.5 }), /start time/);
    assert.deepEqual((await (await run('thread', { account, id: 'thread' })).json()).messages.map((m) => [m.text, m.from]), [['First', 'Alex <alex@example.test>'], ['Private mail', 'Alex <alex@example.test>']]);
    assert.equal((await (await run('counts', { account })).json()).inbox, 14236);
    assert.ok(calls.filter((c) => c.url.includes('gmail.googleapis.com')).every((c) => !c.options.method));
    await assert.rejects(run('trash', { account }), /Unknown Gmail action/);
    // Seam: modify moves a conversation in or out of Inbox and Unread only, never another workspace's.
    for (const bad of [{ add: ['TRASH'] }, { add: ['SPAM'] }, { remove: ['INBOX', 'STARRED'] }, { remove: ['INBOX', 'INBOX'] }, {}, { add: 'INBOX' }]) await assert.rejects(run('modify', { account, id: 'thread', ...bad }), /inbox/);
    await assert.rejects(run('modify', { account, id: 'thread', remove: ['INBOX'] }, other), /Connect this Gmail/);
    await run('modify', { account, id: 'thread', remove: ['INBOX', 'UNREAD'] });
    assert.equal(calls.at(-1).url, 'https://gmail.googleapis.com/gmail/v1/users/me/threads/thread/modify');
    assert.deepEqual(JSON.parse(calls.at(-1).options.body), { addLabelIds: [], removeLabelIds: ['INBOX', 'UNREAD'] });
    // Seam: a reply goes only to whom the answered mail names, inside its conversation.
    const sent = await (await run('send', { account, id: 'one', text: 'See you then.', to: 'evil@attacker.test' })).json();
    const out = JSON.parse(calls.at(-1).options.body), raw = Buffer.from(out.raw, 'base64url').toString();
    assert.deepEqual([sent.to, out.threadId, calls.at(-1).url.endsWith('/messages/send')], [['replies@example.test'], 'thread', true]);
    assert.match(raw, /^To: replies@example\.test\r\nSubject: Re: Hello\r\nIn-Reply-To: <m1@example\.test>\r\nReferences: <m0@example\.test> <m1@example\.test>\r\n/);
    assert.ok(!raw.includes('attacker') && raw.includes(Buffer.from('See you then.').toString('base64')));
    await assert.rejects(run('send', { account, id: 'one', text: 'x'.repeat(20_001) }), /20,000/);
    await assert.rejects(run('send', { account, id: 'one', text: 'Hi' }, other), /Connect this Gmail/);
    await assert.rejects(run('message', { account, id: '../send' }), /Choose a message/);
    const encrypted = seal({ CALENDAR_TOKEN_KEY: env.GMAIL_TOKEN_KEY }, JSON.stringify(['gmail', owner, account]), { access_token: 'old', refresh_token: 'refresh', expires: 0 });
    await sql`UPDATE gmail_accounts SET tokens=${encrypted} WHERE owner=${owner} AND account=${account}`;
    await run('messages', { account }); assert.equal(refreshes, 1);
    await sql`UPDATE gmail_accounts SET tokens=${encrypted} WHERE owner=${owner} AND account=${account}`;
    expired = true; await assert.rejects(run('messages', { account }), /Reconnect/); expired = false;
    await run('disconnect', { account: 'personal' }, other);
    assert.equal((await (await run('accounts')).json()).accounts.length, 2);
    await run('disconnect', { account: 'personal' });
    await assert.rejects(run('message', { account: 'personal', id: 'one' }), /Connect this Gmail/);
    assert.equal((await (await run('accounts')).json()).accounts.length, 1);
    await sql`UPDATE gmail_accounts SET tokens=${encrypted} WHERE owner=${owner} AND account=${account}`;
    disconnectOnRefresh = true; await assert.rejects(run('messages', { account }), /disconnected/);
    assert.equal((await (await run('accounts')).json()).accounts.length, 0);
  } finally { await sql`DELETE FROM gmail_accounts WHERE owner=${owner}`; await sql`DELETE FROM gmail_oauth WHERE owner=${owner}`; await sql.end(); }
});
