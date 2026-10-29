import { readFile } from 'node:fs/promises';
import { database } from './database.mjs';
if (!process.env.DATABASE_URL) throw new Error('Set DATABASE_URL before migrating.');
const sql = database(process.env.DATABASE_URL);
try { await sql.unsafe(await readFile(new URL('./schema.sql', import.meta.url), 'utf8')); } finally { await sql.end(); }
