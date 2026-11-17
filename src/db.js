// Postgres (Supabase) access. Schema: db/schema.sql, created by scripts/setup-db.mjs.
import postgres from 'postgres';
import { createHash } from 'node:crypto';

if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set');
// Supabase's transaction pooler doesn't support prepared statements.
export const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 4, idle_timeout: 20 });

/** pgvector literal for a Float32Array. */
export const vectorLiteral = (vec) => `[${Array.from(vec).join(',')}]`;

// Only tenders from this date on are kept (set once, when the database was set up).
let since;
export const getSince = async () => (since ??= (await sql`SELECT value FROM settings WHERE key = 'since'`)[0].value);

export const listSites = () => sql`SELECT * FROM sites ORDER BY pos`;
export const getSite = async (id) => (await sql`SELECT * FROM sites WHERE id = ${id}`)[0];

export async function addSite(name, url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const id = `${host.split('.')[0].replace(/[^a-z0-9]/gi, '').toLowerCase() || 'site'}-${createHash('sha1').update(url).digest('hex').slice(0, 6)}`;
  const [site] = await sql`INSERT INTO sites (id, name, url, kind, added)
    VALUES (${id}, ${name || host}, ${url}, 'auto', ${new Date().toISOString()}) RETURNING *`;
  return site;
}

/** Remove a site and everything scraped from it. */
export function removeSite(id) {
  return sql.begin(async (tx) => {
    await tx`DELETE FROM tenders WHERE site_id = ${id}`;
    await tx`DELETE FROM site_status WHERE site_id = ${id}`;
    await tx`DELETE FROM ignored WHERE site_id = ${id}`;
    return (await tx`DELETE FROM sites WHERE id = ${id}`).count > 0;
  });
}

export const tenderId = (siteId, it) =>
  createHash('sha1').update(`${siteId}|${it.url || ''}|${it.title.toLowerCase()}`).digest('hex');

const CHUNK = 1000; // rows per INSERT, well under Postgres' 65k parameter limit

/**
 * Upsert scraped items; returns ids of items not seen before.
 * Old notices are recorded in `ignored` instead: dated before the start date, or
 * undated and already on the page at the site's first (baseline) scrape.
 */
export async function saveItems(siteId, items, baseline = false) {
  const SINCE = await getSince();
  const now = new Date().toISOString();
  return sql.begin(async (tx) => {
    const ids = items.map((it) => tenderId(siteId, it));
    const ignored = new Set((await tx`SELECT id FROM ignored WHERE id = ANY(${ids})`).map((r) => r.id));
    const known = new Set((await tx`SELECT id FROM tenders WHERE id = ANY(${ids})`).map((r) => r.id));
    const fresh = [];
    const rows = new Map(); // id -> row; repeats on one page merge like successive upserts
    const skip = [];
    items.forEach((it, i) => {
      const id = ids[i];
      if (ignored.has(id)) return;
      if (!known.has(id) && (it.published ? it.published < SINCE : baseline)) {
        ignored.add(id);
        skip.push({ id, site_id: siteId });
        return;
      }
      if (!known.has(id)) { known.add(id); fresh.push(id); }
      const prev = rows.get(id);
      rows.set(id, {
        id, site_id: siteId,
        title: prev?.title ?? it.title, url: prev?.url ?? it.url ?? null, context: prev?.context ?? it.context ?? null,
        published: prev?.published ?? it.published ?? null,
        org: it.org ?? prev?.org ?? null,
        first_seen: now, last_seen: now,
      });
    });
    const all = [...rows.values()];
    for (let i = 0; i < all.length; i += CHUNK) {
      await tx`INSERT INTO tenders ${tx(all.slice(i, i + CHUNK))}
        ON CONFLICT (id) DO UPDATE SET last_seen = excluded.last_seen,
          published = COALESCE(tenders.published, excluded.published),
          org = COALESCE(excluded.org, tenders.org)`;
    }
    for (let i = 0; i < skip.length; i += CHUNK) {
      await tx`INSERT INTO ignored ${tx(skip.slice(i, i + CHUNK))} ON CONFLICT DO NOTHING`;
    }
    if (baseline && items.length) await tx`UPDATE sites SET baselined = true WHERE id = ${siteId}`;
    return fresh;
  });
}

export const setStatus = (siteId, s) => sql`
  INSERT INTO site_status (site_id, last_run, ok, blocked, found, new_items, error)
  VALUES (${siteId}, ${new Date().toISOString()}, ${!!s.ok}, ${!!s.blocked}, ${s.found ?? 0}, ${s.newItems ?? 0}, ${s.error ?? null})
  ON CONFLICT (site_id) DO UPDATE SET last_run = excluded.last_run, ok = excluded.ok,
    blocked = excluded.blocked, found = excluded.found, new_items = excluded.new_items, error = excluded.error`;

export const unclassified = () => sql`SELECT id, title, context FROM tenders WHERE embedding IS NULL`;

/** @param {{id: string, category: string, score: number, vec: Float32Array}[]} results */
export async function saveClass(results) {
  for (let i = 0; i < results.length; i += 200) {
    const values = results.slice(i, i + 200).map((r) => [r.id, r.category, String(r.score), vectorLiteral(r.vec)]);
    await sql`UPDATE tenders SET category = v.category, score = v.score::real, embedding = v.embedding::vector
      FROM (VALUES ${sql(values)}) AS v (id, category, score, embedding) WHERE tenders.id = v.id`;
  }
}

// Scrape runs. A background function stops after 15 minutes, so a run not
// marked finished within 16 minutes has died and no longer counts as running.

/** Mark a group as running; false if it already is. */
export async function claimRun(group) {
  const rows = await sql`INSERT INTO scrape_runs (grp, started) VALUES (${group}, now())
    ON CONFLICT (grp) DO UPDATE SET started = now(), finished = NULL
    WHERE scrape_runs.finished IS NOT NULL OR scrape_runs.started < now() - interval '16 minutes'
    RETURNING grp`;
  return rows.length > 0;
}
export const finishRun = (group) => sql`UPDATE scrape_runs SET finished = now() WHERE grp = ${group}`;
export const isRunning = async () =>
  (await sql`SELECT 1 FROM scrape_runs WHERE finished IS NULL AND started > now() - interval '16 minutes' LIMIT 1`).length > 0;
