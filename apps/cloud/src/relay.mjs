import { createHash, timingSafeEqual } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const uuid = (value) => typeof value === 'string' && /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/.test(value);
const hash = (value) => typeof value === 'string' && /^[\da-f]{64}$/.test(value);
const cursor = (value) => typeof value === 'string' && /^\d{1,18}$/.test(value);
const label = (value) => typeof value === 'string' && value.trim().length > 0 && value.length <= 80;
const active = (state) => ['queued', 'running', 'stopping'].includes(state);
const sameHash = (a, b) => hash(a) && hash(b) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const recent = (date, seconds) => date && Date.now() - new Date(date).getTime() < seconds * 1000;
const fail = (status, message) => { throw Object.assign(new Error(message), { relayStatus: status }); };
const require = (condition, status, message) => { if (!condition) fail(status, message); };
const iso = (date) => date ? new Date(date).toISOString() : null;
const view = (p) => ({ serverTime: new Date().toISOString(), id: p.id, browserName: p.browser_name, accountName: p.account_name, macName: p.mac_name, state: p.state, expiresAt: iso(p.expires_at), lastSeen: iso(p.last_seen), browserSeen: iso(p.browser_seen), controller: p.controller, ...(p.status ? { status: p.status } : {}) });

function envelope(value, limit = 256 * 1024) {
  const base64 = (s) => typeof s === 'string' && s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s) && Buffer.from(s, 'base64').toString('base64') === s;
  require(value?.v === 1 && base64(value.iv) && Buffer.from(value.iv, 'base64').length === 12 && base64(value.data) && Buffer.from(value.data, 'base64').length >= 16, 400, 'Invalid encrypted envelope.');
  const result = { v: 1, iv: value.iv, data: value.data };
  require(bytes(result) <= limit, 413, 'Encrypted message is too large.');
  return result;
}
function message(body, kinds) {
  require(uuid(body?.id) && uuid(body.controller) && uuid(body.turn) && kinds.includes(body.kind), 400, 'Invalid relay message.');
  return { id: body.id, controller: body.controller, turn: body.turn, kind: body.kind, envelope: envelope(body.envelope, body.kind === 'event' ? 1024 * 1024 : 256 * 1024) };
}
const fingerprint = (item) => createHash('sha256').update(JSON.stringify([item.controller,item.turn,item.kind,item.envelope])).digest('hex');
const equalMessage = (a, b) => a.controller === b.controller && a.turn === b.turn && a.kind === b.kind && isDeepStrictEqual(a.envelope, b.envelope);
async function pair(sql, id, owner) {
  require(uuid(id), 400, 'Invalid connection.');
  const [p] = await sql`SELECT * FROM relay_pairs WHERE id=${id} ${owner ? sql`AND owner=${owner}` : sql``} FOR UPDATE`;
  require(p, 404, 'Connection not found.');
  return p;
}
function live(p) { require(p.state === 'active', 410, 'This connection is not active. Pair the Mac again.'); }
function control(p, id) { require(p.controller === id, 409, 'Another tab controls this Mac. Choose Use this Mac to take over.'); }
function temporary(p) { require(new Date(p.expires_at).getTime() > Date.now(), 410, 'This pairing code expired. Create a new code.'); }
async function interrupt(sql, p) {
  await sql`UPDATE relay_runs SET state='interrupted',updated_at=now() WHERE pair_id=${p.id} AND state IN ('queued','running','stopping')`;
}
async function prune(sql, p) {
  await sql`UPDATE relay_runs SET state='expired',updated_at=now() WHERE pair_id=${p.id} AND state='queued' AND expires_at < now()`;
  if (!recent(p.browser_seen, 60) || !recent(p.last_seen, 60)) await interrupt(sql, p);
  await sql`UPDATE relay_events SET envelope=NULL WHERE seq IN (SELECT seq FROM relay_events WHERE pair_id=${p.id} AND envelope IS NOT NULL AND created_at < now()-interval '24 hours' LIMIT 500)`;
  await sql`DELETE FROM relay_runs WHERE (pair_id,id) IN (SELECT pair_id,id FROM relay_runs WHERE pair_id=${p.id} AND updated_at < now()-interval '7 days' AND state NOT IN ('queued','running','stopping') LIMIT 100)`;
}
async function clearConsumed(sql, id, controller, after = '0') {
  await sql`UPDATE relay_events SET envelope=NULL WHERE seq IN (SELECT seq FROM relay_events WHERE pair_id=${id} AND envelope IS NOT NULL AND (controller!=${controller} OR seq<=${after}) ORDER BY seq LIMIT 500)`;
}
async function revoke(sql, p) {
  await interrupt(sql, p);
  await sql`UPDATE relay_pairs SET state='revoked',status=NULL WHERE id=${p.id}`;
}
async function devicePair(sql, request, body) {
  require(uuid(body.pairId), 400, 'Invalid connection.');
  const token = /^Bearer ([A-Za-z0-9_-]{43,128})$/.exec(request.headers.get('authorization') || '')?.[1];
  require(token, 403, 'Device authorization failed.');
  const [p] = await sql`SELECT * FROM relay_pairs WHERE id=${body.pairId} FOR UPDATE`;
  require(p && sameHash(p.credential_hash, createHash('sha256').update(token).digest('hex')), 403, 'Device authorization failed.');
  require(p.state !== 'revoked', 410, 'This connection was removed. Stop its remote work.');
  return p;
}

export async function relayRequest({ request, sql, user, allowed, readBody }) {
  try {
    const url = new URL(request.url), path = url.pathname.slice('/api/relay/'.length);
    if (path.startsWith('device/')) {
      require(!request.headers.has('origin'), 403, 'Native relay requests cannot include a browser origin.');
      require(request.method === 'POST', 405, 'Use POST for native relay requests.');
      const body = await readBody(request, 1024 * 1024);
      return await sql.begin(async (tx) => {
        if (path === 'device/claim') {
          require(uuid(body.pairId) && hash(body.inviteHash) && hash(body.credentialHash) && label(body.macName), 400, 'Invalid pairing claim.');
          const [p] = await tx`SELECT * FROM relay_pairs WHERE id=${body.pairId} FOR UPDATE`;
          require(p && sameHash(p.invite_hash, body.inviteHash), 403, 'Pairing code is invalid.');
          temporary(p);
          require(p.state === 'pending', 409, 'This pairing code has already been claimed. Create a new code.');
          const [claimed] = await tx`UPDATE relay_pairs SET state='review',credential_hash=${body.credentialHash},mac_name=${body.macName.trim()} WHERE id=${p.id} RETURNING *`;
          return json({ pair: view(claimed) });
        }
        const p = await devicePair(tx, request, body);
        if (path === 'device/revoke') { await revoke(tx, p); return json({ ok: true }); }
        if (path === 'device/approve') {
          if (p.state === 'active') return json({ pair: view(p) });
          temporary(p);
          require(p.state === 'review', 409, 'Review the connection before allowing it.');
          await tx`SELECT pg_advisory_xact_lock(hashtextextended(${p.owner},1))`;
          const [{ count }] = await tx`SELECT count(*)::int AS count FROM relay_pairs WHERE owner=${p.owner} AND state='active'`;
          require(count < 10, 429, 'Remove an old connection before adding another Mac.');
          const [approved] = await tx`UPDATE relay_pairs SET state='active',last_seen=now() WHERE id=${p.id} RETURNING *`;
          return json({ pair: view(approved) });
        }
        live(p);
        await prune(tx, p);
        if (path === 'device/poll') {
          require(cursor(body.after), 400, 'Invalid command cursor.');
          const [{ max }] = await tx`SELECT coalesce(max(seq),0)::text AS max FROM relay_commands WHERE pair_id=${p.id}`;
          require(BigInt(body.after) <= BigInt(max) || BigInt(body.after) === BigInt(p.command_ack), 400, 'Command cursor is ahead of this connection.');
          const after = BigInt(body.after) > BigInt(p.command_ack) ? body.after : String(p.command_ack);
          let status = p.status;
          if (body.status !== undefined) {
            require(uuid(body.status?.id), 400, 'Invalid Mac status.');
            status = { id: body.status.id, envelope: envelope(body.status.envelope, 64 * 1024) };
          }
          const [updated] = await tx`UPDATE relay_pairs SET last_seen=now(),command_ack=${after},status=${status ? tx.json(status) : null} WHERE id=${p.id} RETURNING *`;
          const rows = await tx`SELECT c.seq::text,c.id,c.controller,c.turn,c.kind,c.envelope,c.expires_at FROM relay_commands c JOIN relay_runs r ON r.pair_id=c.pair_id AND r.id=c.turn WHERE c.pair_id=${p.id} AND c.seq>${after} AND c.controller=${p.controller} AND c.expires_at>now() AND r.state IN ('queued','running','stopping') AND (c.kind!='start' OR r.state!='stopping') ORDER BY c.seq LIMIT 50`;
          const commands = [], lease = recent(p.browser_seen, 60); let size = 0;
          if (lease) for (const row of rows) {
            const item = { seq: row.seq, id: row.id, controller: row.controller, turn: row.turn, kind: row.kind, envelope: row.envelope, expiresAt: iso(row.expires_at) };
            if (commands.length && size + bytes(item) > 1024 * 1024) break;
            commands.push(item); size += bytes(item);
          }
          return json({ pair: view(updated), commands });
        }
        if (path === 'device/events') {
          require(Array.isArray(body.events) && body.events.length <= 50 && (!body.runs || Array.isArray(body.runs) && body.runs.length <= 50), 400, 'Invalid event batch.');
          const events = body.events.map((item) => message(item, ['event']));
          const runs = body.runs || [], additions = [];
          for (const event of events) {
            const [run] = await tx`SELECT * FROM relay_runs WHERE pair_id=${p.id} AND id=${event.turn}`;
            require(run && run.controller === event.controller, 409, 'Event does not belong to this turn.');
            const existing = additions.find((item) => item.id === event.id) || (await tx`SELECT * FROM relay_events WHERE pair_id=${p.id} AND id=${event.id}`)[0];
            if (existing) require(existing.fingerprint ? existing.fingerprint === fingerprint(event) : equalMessage(existing, event), 409, 'An event ID cannot be reused for different content.');
            else additions.push(event);
          }
          for (const update of runs) {
            require(uuid(update?.id) && ['running','done','failed','stopped','interrupted'].includes(update.state), 400, 'Invalid turn state.');
            const [run] = await tx`SELECT * FROM relay_runs WHERE pair_id=${p.id} AND id=${update.id}`;
            require(run, 409, 'Turn not found on this connection.');
            if (run.state === update.state) continue;
            if (update.state === 'running') {
              if (run.state === 'stopping' || !active(run.state) && run.controller !== p.controller) continue;
              if (!active(run.state) && events.some((event) => event.turn === run.id) && !additions.some((event) => event.turn === run.id)) continue;
              require(run.state === 'queued' && run.controller === p.controller && recent(p.browser_seen, 60) && new Date(run.expires_at).getTime() > Date.now(), 409, 'This turn can no longer start.');
            } else if (!active(run.state)) continue;
            await tx`UPDATE relay_runs SET state=${update.state},updated_at=now() WHERE pair_id=${p.id} AND id=${update.id}`;
          }
          const [{ total }] = await tx`SELECT coalesce(sum(octet_length(envelope::text)),0)::bigint AS total FROM relay_events WHERE pair_id=${p.id}`;
          require(Number(total) + additions.reduce((n, item) => n + (item.controller === p.controller ? bytes(item.envelope) : 0), 0) <= 20 * 1024 * 1024, 429, 'This connection has reached its event storage limit.');
          for (const event of additions) await tx`INSERT INTO relay_events(pair_id,id,controller,turn,kind,envelope,fingerprint) VALUES(${p.id},${event.id},${event.controller},${event.turn},'event',${event.controller === p.controller ? tx.json(event.envelope) : null},${fingerprint(event)})`;
          return json({ ok: true });
        }
        fail(404, 'Relay route not found.');
      });
    }
    require(user, 401, 'Sign in before connecting a Mac.');
    if (!['GET','HEAD'].includes(request.method)) require(allowed, 403, 'Cloud access has not been enabled for this account yet.');
    if (path === 'pairs' && request.method === 'GET') {
      const pairs = await sql`SELECT * FROM relay_pairs WHERE owner=${user.id} ORDER BY (state='active') DESC,(state IN ('pending','review') AND expires_at>now()) DESC,created_at DESC LIMIT 100`;
      return json({ pairs: pairs.map(view) });
    }
    if (path === 'pairs' && request.method === 'POST') {
      const body = await readBody(request, 2048);
      require(uuid(body.id) && label(body.browserName) && hash(body.inviteHash), 400, 'Invalid pairing invitation.');
      return await sql.begin(async (tx) => {
        await tx`SELECT pg_advisory_xact_lock(hashtextextended(${user.id},1))`;
        const [counts] = await tx`SELECT count(*) FILTER(WHERE state IN ('pending','review') AND expires_at>now())::int AS pending,count(*) FILTER(WHERE state='active')::int AS active,count(*) FILTER(WHERE created_at>now()-interval '1 day')::int AS daily FROM relay_pairs WHERE owner=${user.id}`;
        require(counts.pending < 5 && counts.active < 10, 429, 'Remove an old connection before creating another invitation.');
        require(counts.daily < 30, 429, 'Too many pairing invitations today. Try again tomorrow.');
        const [p] = await tx`INSERT INTO relay_pairs(id,owner,account_name,browser_name,invite_hash) VALUES(${body.id},${user.id},${String(user.name || 'Your account').slice(0,80)},${body.browserName.trim()},${body.inviteHash}) ON CONFLICT(id) DO NOTHING RETURNING *`;
        require(p, 409, 'This invitation ID is already used. Create a new code.');
        return json({ pair: view(p) }, 201);
      });
    }
    const match = /^pairs\/([\da-f-]+)(?:\/(control|events|messages))?$/.exec(path);
    require(match && uuid(match[1]), 404, 'Relay route not found.');
    const body = request.method === 'POST' ? await readBody(request, 270 * 1024) : null;
    return await sql.begin(async (tx) => {
      const p = await pair(tx, match[1], user.id);
      if (!match[2] && request.method === 'DELETE') { await revoke(tx, p); return json({ ok: true }); }
      live(p);
      await prune(tx, p);
      if (match[2] === 'control' && request.method === 'POST') {
        require(uuid(body.controller) && (body.takeover === undefined || typeof body.takeover === 'boolean'), 400, 'Invalid controller.');
        require(!p.controller || p.controller !== body.controller || recent(p.browser_seen, 60), 409, 'This browser lease expired. Reconnect with a new controller.');
        if (p.controller && p.controller !== body.controller && recent(p.browser_seen, 60) && !body.takeover) fail(409, 'Another tab controls this Mac. Choose Use this Mac to take over.');
        if (p.controller !== body.controller) await interrupt(tx, p);
        const [updated] = await tx`UPDATE relay_pairs SET controller=${body.controller},browser_seen=now() WHERE id=${p.id} RETURNING *`;
        if (p.controller !== body.controller) await clearConsumed(tx, p.id, body.controller);
        const [{ after }] = await tx`SELECT coalesce(max(seq),0)::text AS after FROM relay_events WHERE pair_id=${p.id}`;
        return json({ pair: view(updated), after });
      }
      if (match[2] === 'events' && request.method === 'GET') {
        const controller = url.searchParams.get('controller'), after = url.searchParams.get('after') || '0';
        require(uuid(controller) && cursor(after), 400, 'Invalid event cursor.'); control(p, controller);
        require(recent(p.browser_seen, 60), 409, 'This browser connection expired. Choose Use this Mac again.');
        await clearConsumed(tx, p.id, controller, after);
        const [updated] = await tx`UPDATE relay_pairs SET browser_seen=now() WHERE id=${p.id} RETURNING *`;
        const rows = await tx`SELECT seq::text,id,controller,turn,kind,envelope FROM relay_events WHERE pair_id=${p.id} AND controller=${controller} AND seq>${after} AND envelope IS NOT NULL ORDER BY relay_events.seq LIMIT 100`;
        const events = []; let size = 0;
        for (const event of rows) { if (events.length && size + bytes(event) > 1024 * 1024) break; events.push(event); size += bytes(event); }
        return json({ events, pair: view(updated) });
      }
      if (match[2] === 'messages' && request.method === 'POST') {
        const item = message(body, ['start','reply','cancel']); control(p, item.controller);
        require(recent(p.browser_seen, 60), 409, 'This browser connection expired. Choose Use this Mac again.');
        const [existing] = await tx`SELECT * FROM relay_commands WHERE pair_id=${p.id} AND id=${item.id}`;
        if (existing) { require(equalMessage(existing, item), 409, 'A message ID cannot be reused for different content.'); return json({ id: item.id }); }
        const [pending] = await tx`SELECT count(*)::int AS count,coalesce(sum(octet_length(envelope::text)),0)::bigint AS bytes FROM relay_commands c JOIN relay_runs r ON r.pair_id=c.pair_id AND r.id=c.turn WHERE c.pair_id=${p.id} AND c.seq>${p.command_ack} AND c.expires_at>now() AND r.state IN ('queued','running','stopping')`;
        require(pending.count < 200 && Number(pending.bytes) + bytes(item.envelope) <= 5 * 1024 * 1024, 429, 'This Mac has too many messages waiting.');
        let expires;
        if (item.kind === 'start') {
          require(recent(p.last_seen, 25), 409, 'This Mac is offline. Open LeadingLight on the Mac before sending.');
          const [{ busy, hourly }] = await tx`SELECT count(*) FILTER(WHERE state IN ('queued','running','stopping'))::int AS busy,count(*) FILTER(WHERE created_at > now()-interval '1 hour')::int AS hourly FROM relay_runs WHERE pair_id=${p.id}`;
          require(!busy, 409, 'This Mac is already running a turn for this connection.'); require(hourly < 30, 429, 'This connection has reached its hourly turn limit.');
          const [run] = await tx`INSERT INTO relay_runs(pair_id,id,controller,state) VALUES(${p.id},${item.turn},${item.controller},'queued') ON CONFLICT(pair_id,id) DO NOTHING RETURNING *`;
          require(run, 409, 'This turn ID was already used. Start a new turn.'); expires = run.expires_at;
        } else {
          const [run] = await tx`SELECT * FROM relay_runs WHERE pair_id=${p.id} AND id=${item.turn}`;
          require(run && run.controller === item.controller && active(run.state), 409, 'This turn is no longer active on this connection.');
          if (item.kind === 'cancel') await tx`UPDATE relay_runs SET state='stopping',updated_at=now() WHERE pair_id=${p.id} AND id=${item.turn}`;
          expires = new Date(Date.now() + 60_000);
        }
        await tx`INSERT INTO relay_commands(pair_id,id,controller,turn,kind,envelope,expires_at) VALUES(${p.id},${item.id},${item.controller},${item.turn},${item.kind},${tx.json(item.envelope)},${expires})`;
        await tx`UPDATE relay_pairs SET browser_seen=now() WHERE id=${p.id}`;
        return json({ id: item.id });
      }
      fail(405, 'This relay operation does not support that method.');
    });
  } catch (error) {
    if (error.relayStatus) return json({ error: error.message }, error.relayStatus);
    if (error instanceof RangeError || error instanceof SyntaxError) return json({ error: 'Relay request is too large or invalid.' }, 400);
    throw error;
  }
}
