import { relayRequest } from './relay.mjs';
import { NativeError, authenticateNative, nativePublicRequest, nativeBrowserRequest, revokeNative } from './native.mjs';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const enabled = (env, id) => env.CLOUD_ACCESS === 'public' || (env.CLOUD_ALLOWED_USERS || '').split(',').map((v) => v.trim()).includes(id);
const bounded = (value, max) => typeof value === 'string' && value.length <= max;
const agentsUnavailable = () => json({ error: 'Connect the installed Mac app to run agents using your Claude Code or Codex sign-in. Hosted model jobs are not available.' }, 410);

export function application({ env, sql, auth }) {
  const origin = env.APP_ORIGIN ? new URL(env.APP_ORIGIN).origin : "";
  return async (request) => {
    try {
      const url = new URL(request.url), path = url.pathname;
      if (origin && url.origin !== origin) return json({ error: 'Unexpected host.' }, 400);
      if (path.startsWith('/api/relay/device/')) return await relayRequest({ request, sql, readBody: limitedBody });
      if (['/api/native/start', '/api/native/poll'].includes(path)) return auth.ready ? await nativePublicRequest({ request, sql, readBody: limitedBody, origin }) : json({ error: 'Cloud sign-in has not been configured.' }, 503);
      const native = request.headers.has('authorization') ? await authenticateNative(request, sql) : null;
      if (!native && !['GET', 'HEAD'].includes(request.method) && request.headers.get('origin') !== origin) return json({ error: 'Unexpected origin.' }, 403);
      if (path === '/api/config') return json({ allowed: enabled(env, (native?.user ?? await auth.user(request))?.id), ready: auth.ready, providers: auth.providers, agents: [] });
      if (path.startsWith('/api/auth/')) return auth.ready ? auth.handle(request) : json({ error: 'Cloud sign-in has not been configured.' }, 503);
      if (path === '/api/worker' || path === '/api/queue-worker') return agentsUnavailable();
      const user = native?.user ?? await auth.user(request);
      if (!user) return json({ error: 'Sign in to use cloud features.' }, 401);
      const expectedOwner = request.headers.get('x-leadinglight-owner');
      if (expectedOwner && expectedOwner !== user.id) return json({ error: 'The signed-in account changed. Reconnect to the original workspace and try again.' }, 409);
      if (path === '/api/me') return json(native ? { ...user, expiresAt: native.expiresAt } : user);
      if (path === '/api/native/revoke' && request.method === 'POST') return native ? await revokeNative(sql, native) : json({ error: 'Use the installed app to sign out this device.' }, 403);
      if (path.startsWith('/api/native/')) return await nativeBrowserRequest({ request, sql, user, allowed: enabled(env, user.id), readBody: limitedBody });
      if (path.startsWith('/api/relay/')) return await relayRequest({ request, sql, user, allowed: enabled(env, user.id), readBody: limitedBody });
      if (path === '/api/jobs' && request.method === 'GET') return json({ jobs: [] });
      if (path === '/api/jobs' || path.startsWith('/api/jobs/')) return agentsUnavailable();
      if (request.method === 'POST' && !enabled(env, user.id)) return json({ error: 'Cloud access has not been enabled for this account yet.' }, 403);
      if (path === '/api/sync-part' && request.method === 'GET') {
        const id = url.searchParams.get('id');
        if (!bounded(id, 200)) return json({ error: 'Invalid part.' }, 400);
        const rows = await sql`SELECT envelope FROM sync_events WHERE owner=${user.id} AND id=${id} AND envelope->>'kind'='part'`;
        return rows.length ? json(rows[0].envelope) : json({ error: 'Sync part not found.' }, 404);
      }
      if (path === '/api/sync' && request.method === 'GET') {
        const after = url.searchParams.get('after') ?? '0';
        if (!/^\d{1,18}$/.test(after)) return json({ error: 'Invalid cursor.' }, 400);
        const rows = await sql`SELECT seq::text,id,envelope FROM sync_events WHERE owner=${user.id} AND seq>${after} AND coalesce(envelope->>'kind','event') != 'part' ORDER BY seq LIMIT 50`;
        const events = []; let bytes = 0;
        for (const row of rows) {
          const size = Buffer.byteLength(JSON.stringify(row));
          if (events.length && bytes + size > 3_500_000) break;
          events.push(row); bytes += size;
        }
        return json({ events });
      }
      if (path === '/api/sync' && request.method === 'POST') {
        const body = await limitedBody(request, 4_000_000);
        const e = body.envelope;
        const validData = e?.kind === 'manifest' ? Array.isArray(e.parts) && e.parts.length > 0 && e.parts.length <= 200 && e.parts.every((part) => bounded(part, 200)) : bounded(e?.data, 3_900_000);
        if (!bounded(body.id, 200) || !body.id || e?.v !== 1 || !bounded(e.iv, 32) || !validData) return json({ error: 'Invalid encrypted event.' }, 400);
        const saved = await sql.begin(async (tx) => {
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${user.id},0))`;
          const [{ bytes }] = await tx`SELECT coalesce(sum(pg_column_size(envelope)),0)::bigint AS bytes FROM sync_events WHERE owner=${user.id}`;
          if (Number(bytes) > 500_000_000) return false;
          await tx`INSERT INTO sync_events(owner,id,envelope) VALUES(${user.id},${body.id},${tx.json(body.envelope)}) ON CONFLICT(owner,id) DO NOTHING`;
          return true;
        });
        return saved ? json({ ok: true }) : json({ error: 'Sync storage is full. Your local notes are safe.' }, 413);
      }
      return json({ error: 'Not found.' }, 404);
    } catch (error) {
      if (error instanceof NativeError) return json({ error: error.message }, error.status);
      if (error instanceof RangeError || error instanceof SyntaxError) return json({ error: 'Request is too large or invalid.' }, 400);
      console.error('Cloud request failed', error instanceof Error ? error.name : 'Error');
      return json({ error: 'Cloud is temporarily unavailable. Your local notes are safe.' }, 503);
    }
  };
}

async function limitedBody(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) throw new SyntaxError('Missing body');
  let length = 0; const chunks = [];
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    length += value.length;
    if (length > limit) { await reader.cancel(); throw new RangeError('Body too large'); }
    chunks.push(value);
  }
  const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new SyntaxError('Expected an object');
  return value;
}
