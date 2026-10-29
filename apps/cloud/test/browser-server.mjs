import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { readFile } from 'node:fs/promises';
import { application } from '../src/app.mjs';
import { database } from '../src/database.mjs';
if (!process.env.TEST_DATABASE_URL?.includes('127.0.0.1:55439/')) throw new Error('Use the isolated QA database.');
const sql = database(process.env.TEST_DATABASE_URL);
await sql.unsafe(await readFile(new URL('../src/schema.sql', import.meta.url), 'utf8'));
const env = { CLOUD_ACCESS: 'public', APP_ORIGIN: 'http://127.0.0.1:1431' };
const auth = { ready: true, providers: [], user: async (req) => { const id = /(?:^|;\s*)qa-user=([^;]+)/.exec(req.headers.get('cookie') || '')?.[1]; return id ? { id, name: 'QA account' } : null; } };
const app = application({ env, sql, auth });
createServer(async (req, res) => {
  const response = await app(new Request(new URL(req.url, env.APP_ORIGIN), { method: req.method, headers: req.headers, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Readable.toWeb(req), duplex: 'half' } : {}) }));
  res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
}).listen(8787, '127.0.0.1', () => console.log('Fixture sign-in; real PostgreSQL; local browser only'));
