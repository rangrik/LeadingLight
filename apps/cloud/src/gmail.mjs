import { createHash, randomBytes } from 'node:crypto';
import { seal, unseal } from './calendar.mjs';
import { NativeError } from './native.mjs';

const json = (body) => Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
const need = (ok, status, message) => { if (!ok) throw new NativeError(status, message); };
const string = (s, max = 1024) => typeof s === 'string' && s.length > 0 && s.length <= max;
const hash = (s) => createHash('sha256').update(s).digest('hex');
const scope = 'https://www.googleapis.com/auth/gmail.modify';
const gmailId = (s) => string(s, 128) && /^[a-zA-Z0-9_-]+$/.test(s);
// Done, Later and Undo only ever move a conversation in or out of the inbox, or read or unread.
const movable = new Set(['INBOX', 'UNREAD']);
const key = (env) => ({ CALENDAR_TOKEN_KEY: env.GMAIL_TOKEN_KEY });
const binding = (owner, account = '') => JSON.stringify(['gmail', owner, account]);
const callbackUrl = (env) => `${new URL(env.APP_ORIGIN).origin}/api/gmail/callback`;
export const gmailReady = (env) => Boolean(env.GMAIL_CLIENT_ID && env.GMAIL_CLIENT_SECRET && /^[A-Za-z0-9+/]{43}=$/.test(env.GMAIL_TOKEN_KEY || ''));

async function google(url, options = {}, fetcher = fetch) {
  let response;
  try { response = await fetcher(url, { ...options, signal: AbortSignal.timeout(15000) }); }
  catch { throw new NativeError(503, 'Gmail could not be reached. Check your connection and try again.'); }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const expired = response.status === 401 || data.error === 'invalid_grant';
    const messages = { 403: 'Google refused Gmail access. Reconnect or check your work account policy.', 404: 'This message is no longer available.', 429: 'Gmail is busy. Wait a moment and try again.' };
    throw new NativeError(expired ? 401 : response.status, expired ? 'Gmail access expired. Reconnect this account.' : messages[response.status] || 'Gmail could not complete this request. Try again.');
  }
  return data;
}
const tokenRequest = (env, params, fetcher) => google('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, client_secret: env.GMAIL_CLIENT_SECRET, ...params }) }, fetcher);

async function grant({ env, sql, user, account, fetcher }) {
  need(string(account), 400, 'Choose a Gmail account.');
  const [row] = await sql`SELECT tokens FROM gmail_accounts WHERE owner=${user.id} AND account=${account}`;
  need(row, 404, 'Connect this Gmail account first.');
  let tokens = unseal(key(env), binding(user.id, account), row.tokens);
  const refresh = async () => {
    const next = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token }, fetcher);
    need(string(next.access_token) && Number.isFinite(next.expires_in), 502, 'Google returned an invalid connection. Reconnect Gmail.');
    tokens = { ...tokens, ...next, expires: Date.now() + next.expires_in * 1000 };
    const saved = await sql`UPDATE gmail_accounts SET tokens=${seal(key(env), binding(user.id, account), tokens)} WHERE owner=${user.id} AND account=${account} AND tokens=${row.tokens} RETURNING account`;
    if (!saved.length) {
      const [current] = await sql`SELECT tokens FROM gmail_accounts WHERE owner=${user.id} AND account=${account}`;
      need(current, 404, 'This Gmail account was disconnected.');
      tokens = unseal(key(env), binding(user.id, account), current.tokens);
    }
  };
  if (tokens.expires < Date.now() + 60000) await refresh();
  return async (path, body) => {
    const read = () => google(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, { headers: { Authorization: `Bearer ${tokens.access_token}`, ...(body && { 'Content-Type': 'application/json' }) }, ...(body && { method: 'POST', body: JSON.stringify(body) }) }, fetcher);
    try { return await read(); } catch (error) { if (error.status !== 401) throw error; await refresh(); return read(); }
  };
}
const header = (part, name) => (part?.headers || []).find((h) => h.name.toLowerCase() === name)?.value || '';
const displayHeader = (part, name) => header(part, name).replace(/(\?=)\s+(=\?)/g, '$1$2').replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (word, charset, encoding, data) => {
  try {
    const bytes = encoding.toLowerCase() === 'b' ? Buffer.from(data, 'base64') : Buffer.from(data.replace(/_/g, ' ').replace(/=([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'latin1');
    return new TextDecoder(charset).decode(bytes);
  } catch { return word; }
});
export function summary(message) {
  const labels = (message.labelIds || []).filter((l) => typeof l === 'string' && l.length <= 128);
  return { id: message.id, threadId: message.threadId, subject: displayHeader(message.payload, 'subject'), from: displayHeader(message.payload, 'from'), to: displayHeader(message.payload, 'to'), cc: displayHeader(message.payload, 'cc'), replyTo: displayHeader(message.payload, 'reply-to'), date: Number(message.internalDate) || 0, snippet: message.snippet || '', unread: labels.includes('UNREAD'), labels, unsubscribe: Boolean(header(message.payload, 'list-unsubscribe')) };
}

// Addresses only, rebuilt from a header, so nothing the sender wrote can add a header or a recipient.
const addresses = (value) => (value.match(/(?:[^,"]|"[^"]*")+/g) || []).map((part) => (/<([^<>]+)>\s*$/.exec(part)?.[1] ?? part).trim()).filter((a) => /^[^\s@<>()",;:\\[\]]+@[^\s@<>()",;:\\[\]]+\.[^\s@<>()",;:\\[\]]+$/.test(a)).slice(0, 20);
const messageIds = (value) => (value.match(/<[^<>\s]{1,250}>/g) || []).slice(-20);
const encoded = (s) => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
export function replyTo(original, text) {
  const to = addresses(header(original.payload, 'reply-to')).length ? addresses(header(original.payload, 'reply-to')) : addresses(header(original.payload, 'from'));
  need(to.length, 422, 'This mail has no address to reply to.');
  const subject = displayHeader(original.payload, 'subject').replace(/[\r\n]+/g, ' ').trim().slice(0, 500);
  const [id] = messageIds(header(original.payload, 'message-id')), references = [...messageIds(header(original.payload, 'references')), ...(id ? [id] : [])];
  const lines = [`To: ${to.join(', ')}`, `Subject: ${encoded(/^re:/i.test(subject) ? subject : `Re: ${subject}`)}`, ...(id ? [`In-Reply-To: ${id}`, `References: ${references.join(' ')}`] : []), 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', Buffer.from(text.replace(/\r?\n/g, '\r\n')).toString('base64').replace(/.{76}/g, '$&\r\n')];
  return { to, raw: Buffer.from(lines.join('\r\n')).toString('base64url'), threadId: original.threadId };
}

// MIME bodies may be nested or stored as attachment parts; filenames are never body text.
export async function content(message, api) {
  const attachments = [], plain = [], html = [];
  let bytes = 0, parts = 0;
  const visit = async (part, depth = 0) => {
    need(depth < 30 && ++parts <= 500, 413, 'This email is too complex. Open it in Gmail.');
    if (part.filename || /^attachment/i.test(header(part, 'content-disposition'))) {
      attachments.push({ name: part.filename || 'Attachment', size: part.body?.size || 0 }); return;
    }
    if (['text/plain', 'text/html'].includes(part.mimeType)) {
      bytes += part.body?.size || 0;
      need(bytes <= 2_000_000, 413, 'This email is too large to display. Open it in Gmail.');
      const body = part.body?.attachmentId ? await api(`/messages/${encodeURIComponent(message.id)}/attachments/${encodeURIComponent(part.body.attachmentId)}`) : part.body;
      if (body?.data) {
        const buffer = Buffer.from(body.data, 'base64url');
        need(buffer.length <= 2_000_000, 413, 'This email is too large to display. Open it in Gmail.');
        const charset = /charset=["']?([^;"'\s]+)/i.exec(header(part, 'content-type'))?.[1] || 'utf-8';
        let text;
        try { text = new TextDecoder(charset).decode(buffer); } catch { text = buffer.toString('utf8'); }
        (part.mimeType === 'text/plain' ? plain : html).push(text);
      }
    }
    for (const child of part.parts || []) await visit(child, depth + 1);
  };
  if (message.payload) await visit(message.payload);
  return { ...summary(message), text: plain.join('\n\n'), html: plain.length ? '' : html.join('\n'), attachments };
}

export async function gmailRequest({ request, env, sql, user, readBody, fetcher = fetch }) {
  need(gmailReady(env), 503, 'Gmail is not configured on this installation yet.');
  const action = new URL(request.url).pathname.slice('/api/gmail/'.length);
  if (action === 'accounts' && request.method === 'GET') return json({ accounts: await sql`SELECT account,email FROM gmail_accounts WHERE owner=${user.id} ORDER BY email` });
  need(['connect', 'disconnect', 'messages', 'message', 'thread', 'counts', 'modify', 'send'].includes(action), 404, 'Unknown Gmail action.');
  need(request.method === 'POST', 405, 'Use POST for Gmail actions.');
  const body = await readBody(request, action === 'send' ? 130_000 : 16000);
  need(body && typeof body === 'object' && !Array.isArray(body), 400, 'Supply Gmail request details.');
  if (action === 'connect') {
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
    await sql`DELETE FROM gmail_oauth WHERE expires_at<now()`;
    await sql`INSERT INTO gmail_oauth(state,owner,verifier) VALUES(${hash(state)},${user.id},${seal(key(env), binding(user.id), verifier)})`;
    const params = new URLSearchParams({ client_id: env.GMAIL_CLIENT_ID, redirect_uri: callbackUrl(env), response_type: 'code', scope: `openid email ${scope}`, access_type: 'offline', prompt: 'consent select_account', state, code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' });
    return json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` });
  }
  need(string(body.account), 400, 'Choose a Gmail account.');
  if (action === 'disconnect') {
    await sql`DELETE FROM gmail_accounts WHERE owner=${user.id} AND account=${body.account}`;
    return json({ ok: true });
  }
  need(body.query === undefined || typeof body.query === 'string' && body.query.length <= 1000, 400, 'Search must be at most 1,000 characters.');
  need(body.pageToken === undefined || string(body.pageToken, 2048), 400, 'Invalid Gmail page.');
  need(body.after === undefined || Number.isInteger(body.after) && body.after > 0 && body.after < 1e11 && !body.query, 400, 'Invalid start time.');
  need(body.max === undefined || Number.isInteger(body.max) && body.max >= 1 && body.max <= 25, 400, 'Ask for 1 to 25 messages.');
  if (['message', 'thread', 'modify', 'send'].includes(action)) need(gmailId(body.id), 400, 'Choose a message.');
  if (action === 'modify') {
    const labels = [...(Array.isArray(body.add) ? body.add : []), ...(Array.isArray(body.remove) ? body.remove : [])];
    need([body.add, body.remove].every((l) => l === undefined || Array.isArray(l)) && labels.length && labels.every((l) => movable.has(l)) && new Set(labels).size === labels.length, 400, 'Mail can only be moved in or out of the inbox, or marked read or unread.');
  }
  if (action === 'send') need(typeof body.text === 'string' && body.text.trim() && body.text.length <= 20_000, 400, 'A reply must be plain text of at most 20,000 characters.');
  const api = await grant({ env, sql, user, account: body.account, fetcher });
  if (action === 'message') return json({ message: await content(await api(`/messages/${body.id}?format=full`), api) });
  if (action === 'counts') return json({ inbox: Number((await api('/labels/INBOX')).messagesTotal) || 0 });
  if (action === 'thread') {
    const list = ((await api(`/threads/${body.id}?format=full`)).messages || []).sort((a, b) => Number(a.internalDate) - Number(b.internalDate)).slice(-30), messages = [];
    for (const message of list) messages.push(await content(message, api));
    // The Mac app takes at most 4.5 MB per answer, so the oldest messages go first.
    let size = messages.reduce((n, m) => n + m.text.length + m.html.length, 0);
    while (messages.length > 1 && size > 3_000_000) { const m = messages.shift(); size -= m.text.length + m.html.length; }
    return json({ messages });
  }
  if (action === 'modify') {
    await api(`/threads/${body.id}/modify`, { addLabelIds: body.add || [], removeLabelIds: body.remove || [] });
    return json({ ok: true });
  }
  if (action === 'send') {
    // The recipient, subject and thread come from the mail being answered, never from the client.
    const reply = replyTo(await api(`/messages/${body.id}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`), body.text);
    const sent = await api('/messages/send', { raw: reply.raw, threadId: reply.threadId });
    return json({ id: sent.id, threadId: sent.threadId, to: reply.to });
  }
  const q = body.after ? `in:inbox after:${body.after}` : body.query?.trim();
  const params = new URLSearchParams({ maxResults: String(body.max || 25), ...(q ? { q } : { labelIds: 'INBOX' }), ...(body.pageToken && { pageToken: body.pageToken }) });
  const page = await api(`/messages?${params}`), messages = [];
  // Small batches keep large inboxes from exhausting Google's per-user concurrency.
  for (let i = 0; i < (page.messages || []).length; i += 5) {
    const batch = await Promise.all(page.messages.slice(i, i + 5).map(async ({ id }) => {
      try { return summary(await api(`/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Reply-To&metadataHeaders=List-Unsubscribe`)); }
      catch (error) { if (error.status === 404) return null; throw error; }
    }));
    messages.push(...batch.filter(Boolean));
  }
  return json({ messages, nextPageToken: page.nextPageToken || null });
}

export async function gmailCallback({ request, env, sql, user, fetcher = fetch }) {
  need(gmailReady(env), 503, 'Gmail is not configured.');
  need(request.method === 'GET', 405, 'Use the Google callback link.');
  const params = new URL(request.url).searchParams, state = params.get('state');
  need(string(state, 100), 400, 'Invalid Gmail connection. Start again from Mail.');
  const [pending] = await sql`DELETE FROM gmail_oauth WHERE state=${hash(state)} AND owner=${user.id} AND expires_at>now() RETURNING verifier`;
  need(pending, 400, 'This Gmail connection expired or belongs to another workspace. Start again from Mail.');
  if (params.has('error')) return Response.redirect(`${env.APP_ORIGIN}/?gmail=cancelled`, 303);
  need(string(params.get('code'), 4096), 400, 'Google did not return an authorization code.');
  const tokens = await tokenRequest(env, { code: params.get('code'), grant_type: 'authorization_code', redirect_uri: callbackUrl(env), code_verifier: unseal(key(env), binding(user.id), pending.verifier) }, fetcher);
  need((tokens.scope || '').split(' ').includes(scope), 403, 'Allow LeadingLight to read, reply to and put away Gmail when connecting.');
  need(string(tokens.access_token) && Number.isFinite(tokens.expires_in), 502, 'Google returned an invalid connection.');
  const profile = await google('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${tokens.access_token}` } }, fetcher);
  need(string(profile.sub) && string(profile.email) && profile.email_verified === true, 400, 'Google did not identify this account.');
  const [old] = await sql`SELECT tokens FROM gmail_accounts WHERE owner=${user.id} AND account=${profile.sub}`;
  if (!tokens.refresh_token && old) tokens.refresh_token = unseal(key(env), binding(user.id, profile.sub), old.tokens).refresh_token;
  need(string(tokens.refresh_token, 4096), 400, 'Google did not grant background access. Reconnect with consent.');
  tokens.expires = Date.now() + tokens.expires_in * 1000;
  await sql`INSERT INTO gmail_accounts(owner,account,email,tokens) VALUES(${user.id},${profile.sub},${profile.email},${seal(key(env), binding(user.id, profile.sub), tokens)}) ON CONFLICT(owner,account) DO UPDATE SET email=excluded.email,tokens=excluded.tokens`;
  return Response.redirect(`${env.APP_ORIGIN}/?gmail=connected`, 303);
}
