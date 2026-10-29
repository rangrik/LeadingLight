import { application } from '../apps/cloud/src/app.mjs';
import { authentication } from '../apps/cloud/src/auth.mjs';
import { database } from '../apps/cloud/src/database.mjs';
const env = process.env;
const sql = env.DATABASE_URL ? database(env.DATABASE_URL) : null;
const handle = application({ env, sql, auth: authentication(env) });
export default async function gateway(req, res) {
  const route = Array.isArray(req.query.route) ? req.query.route.join('/') : (req.query.route || 'config');
  const url = new URL(`/api/${route}`, env.APP_ORIGIN || `https://${req.headers.host}`);
  for (const [key, value] of Object.entries(req.query)) if (key !== 'route') url.searchParams.set(key, String(value));
  const form = req.headers['content-type']?.includes('application/x-www-form-urlencoded');
  const body = ['GET', 'HEAD'].includes(req.method) ? undefined : typeof req.body === 'string' ? req.body : form ? new URLSearchParams(req.body).toString() : JSON.stringify(req.body);
  const response = await handle(new Request(url, { method: req.method, headers: req.headers, body }));
  res.statusCode = response.status;
  response.headers.forEach((value, key) => { if (key !== 'set-cookie') res.setHeader(key, value); });
  if (response.headers.getSetCookie().length) res.setHeader('set-cookie', response.headers.getSetCookie());
  res.end(Buffer.from(await response.arrayBuffer()));
}
