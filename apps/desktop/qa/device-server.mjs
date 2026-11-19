// Fixture cloud for device-connections QA: the real routes and PostgreSQL, a cookie sign-in, loopback only.
// Run with TEST_DATABASE_URL pointing to a local test database.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { application } from '../../cloud/src/app.mjs';
import { database } from '../../cloud/src/database.mjs';

const url = process.env.TEST_DATABASE_URL;
const host = url && new URL(url).hostname;
if (!['127.0.0.1','localhost','[::1]'].includes(host)) throw new Error('Set TEST_DATABASE_URL to an isolated local PostgreSQL database.');
const sql = database(url);
await sql.unsafe(await readFile(new URL('../../cloud/src/schema.sql', import.meta.url), 'utf8'));
const port = Number(process.env.CLOUD_PORT || 18788);
const env = { CLOUD_ACCESS: 'public', APP_ORIGIN: `http://127.0.0.1:${port}` };
const cookie = (req, name) => new RegExp(`(?:^|;\\s*)${name}=([^;]+)`).exec(req.headers.get('cookie') || '')?.[1];
const auth = { ready: true, providers: [{ id: 'google', name: 'Google' }], user: async (req) => { const id = cookie(req, 'qa-user'); return id ? { id, name: 'QA account' } : null; } };
const app = application({ env, sql, auth });
createServer(async (req, res) => {
  const path = new URL(req.url, env.APP_ORIGIN).pathname;
  // The only way to age a request: the real one lasts two minutes.
  if (path === '/__qa/expire') {
    const id = new URL(req.url, env.APP_ORIGIN).searchParams.get('id');
    await sql`UPDATE device_links SET expires_at=now()-interval '1 second' WHERE id=${id} AND owner LIKE 'qa-dev-%'`;
    return res.end('ok');
  }
  const response = await app(new Request(new URL(req.url, env.APP_ORIGIN), { method: req.method, headers: req.headers, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Readable.toWeb(req), duplex: 'half' } : {}) }));
  res.writeHead(response.status, Object.fromEntries(response.headers));
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, '127.0.0.1', () => console.log(`Device QA cloud on http://127.0.0.1:${port} (fixture sign-in, real routes)`));
