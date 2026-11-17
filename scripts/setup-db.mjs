// Create the tables; on an empty database, seed the built-in site list with today as the start date:
//   DATABASE_URL=... node scripts/setup-db.mjs
// Safe to re-run: existing settings and sites are kept.
import { readFileSync } from 'node:fs';
import { sql } from '../src/db.js';
import { SITES } from '../src/sites.js';

await sql.unsafe(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
console.log('schema ready');

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date()); // YYYY-MM-DD
await sql`INSERT INTO settings (key, value) VALUES ('since', ${today}) ON CONFLICT DO NOTHING`;
// Seed only an empty list: sites removed on the dashboard must not come back.
if ((await sql`SELECT 1 FROM sites LIMIT 1`).length) {
  console.log('sites: already set up, left as they are');
} else {
  const now = new Date().toISOString();
  await sql`INSERT INTO sites ${sql(SITES.map((s) => ({
    id: s.id, name: s.name, url: s.url, kind: s.kind, scope: s.scope ?? null, section: s.section ?? 'bank', added: now,
  })))}`;
  console.log(`sites: ${SITES.length} seeded`);
}
await sql.end();
