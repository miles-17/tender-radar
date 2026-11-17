// Create the tables, then fill an empty database:
//   DATABASE_URL=... node scripts/setup-db.mjs                  seed the built-in site list, start date = today
//   DATABASE_URL=... node scripts/setup-db.mjs path/tenders.db  copy everything from the old SQLite database
// Safe to re-run: existing rows are kept.
import { readFileSync } from 'node:fs';
import { sql, vectorLiteral } from '../src/db.js';
import { SITES } from '../src/sites.js';

await sql.unsafe(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
console.log('schema ready');

const sqlitePath = process.argv[2];
const CHUNK = 500;
const insertAll = async (table, rows) => {
  for (let i = 0; i < rows.length; i += CHUNK) {
    await sql`INSERT INTO ${sql(table)} ${sql(rows.slice(i, i + CHUNK))} ON CONFLICT DO NOTHING`;
  }
  console.log(`${table}: ${rows.length} rows`);
};

if (sqlitePath) {
  const { DatabaseSync } = await import('node:sqlite');
  const old = new DatabaseSync(sqlitePath, { readOnly: true });
  const all = (q) => old.prepare(q).all().map((r) => ({ ...r }));
  const bool = (v) => (v == null ? null : !!v);
  await insertAll('settings', all('SELECT key, value FROM settings'));
  await insertAll('sites', all('SELECT id, name, url, kind, scope, added, baselined, section FROM sites ORDER BY added, rowid')
    .map((s) => ({ ...s, baselined: !!s.baselined })));
  await insertAll('site_status', all('SELECT * FROM site_status')
    .map((s) => ({ ...s, ok: bool(s.ok), blocked: bool(s.blocked) })));
  await insertAll('ignored', all('SELECT id, site_id FROM ignored'));
  await insertAll('tenders', all('SELECT * FROM tenders').map(({ embedding, ...t }) => ({
    ...t,
    embedding: embedding ? vectorLiteral(new Float32Array(Uint8Array.from(embedding).buffer)) : null,
  })));
} else {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()); // YYYY-MM-DD
  await sql`INSERT INTO settings (key, value) VALUES ('since', ${today}) ON CONFLICT DO NOTHING`;
  const now = new Date().toISOString();
  await insertAll('sites', SITES.map((s) => ({
    id: s.id, name: s.name, url: s.url, kind: s.kind, scope: s.scope ?? null, section: s.section ?? 'bank', added: now,
  })));
}
await sql.end();
