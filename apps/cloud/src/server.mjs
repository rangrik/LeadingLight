import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { application } from './app.mjs';
import { authentication } from './auth.mjs';
import { database } from './database.mjs';
const env = process.env;
const sql = env.DATABASE_URL ? database(env.DATABASE_URL) : null;
const handle = application({ env, sql, auth: authentication(env) });
createServer(async (req, res) => {
  const request = new Request(new URL(req.url, env.APP_ORIGIN || 'http://127.0.0.1:1431'), { method: req.method, headers: req.headers, ...(req.method !== 'GET' && req.method !== 'HEAD' ? { body: Readable.toWeb(req), duplex: 'half' } : {}) });
  const response = await handle(request);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => { if (key !== "set-cookie") res.setHeader(key, value); });
  if (response.headers.getSetCookie().length) res.setHeader("set-cookie", response.headers.getSetCookie());
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(Number(env.PORT || 8787), '127.0.0.1', () => console.log('Cloud service on 127.0.0.1:8787'));
