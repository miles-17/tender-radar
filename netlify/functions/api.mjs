// Dashboard API. The password gate (netlify/edge-functions/gate.js) runs before it.
import { sql, vectorLiteral, listSites, addSite, removeSite, isRunning } from '../../src/db.js';
import { allGroups } from '../../src/groups.js';
import { triggerScrape } from '../../src/trigger.js';

const DIMS = 384; // bge-small-en-v1.5
const httpError = (status, message) => Object.assign(new Error(message), { status });
const json = (body, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });

/** Search vector from the browser: base64 of a normalized Float32Array. */
function queryVector(b64) {
  const buf = Buffer.from(b64, 'base64');
  if (buf.length !== DIMS * 4) throw httpError(400, 'bad search vector');
  const vec = new Float32Array(new Uint8Array(buf).buffer);
  if (!vec.every(Number.isFinite)) throw httpError(400, 'bad search vector');
  return vec;
}

async function listTenders(params) {
  // Section: bank tender pages or ministries & departments (government sources).
  const where = [sql`site_id IN (SELECT id FROM sites WHERE section = ${params.get('section') === 'gov' ? 'gov' : 'bank'})`];
  // Ministry, or "Ministry › Division": matches that org and everything under it.
  const org = params.get('org');
  if (org) where.push(sql`(org = ${org} OR left(org, length(${org}) + 3) = ${org} || ' › ')`);
  const cat = params.get('category') || 'software';
  if (cat !== 'all') where.push(sql`category = ${cat}`);
  const site = params.get('site');
  if (site) where.push(sql`site_id = ${site}`);
  // Date filters use the date on the bank's page, else the day we first saw it.
  const days = Math.round(Number(params.get('days') || 0));
  if (days > 0) where.push(sql`COALESCE(published, left(first_seen, 10)) >= to_char(current_date - ${days}::int, 'YYYY-MM-DD')`);
  // Custom range: from/to are inclusive YYYY-MM-DD; either may be left open.
  // Matches the page date only: undated tenders all share the day of the first
  // scrape, so a first_seen fallback would flood any range covering that day.
  for (const key of ['from', 'to']) {
    const d = params.get(key);
    if (!d) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw httpError(400, `${key} must be YYYY-MM-DD`);
    where.push(key === 'from' ? sql`published >= ${d}` : sql`published <= ${d}`);
  }
  const q = (params.get('q') || '').trim();
  const qv = params.get('qv');
  // No search vector (the browser couldn't load the model): plain title match.
  if (q && !qv) where.push(sql`strpos(lower(title), ${q.toLowerCase()}) > 0`);
  const cond = where.reduce((a, b) => sql`${a} AND ${b}`);
  let rows;
  if (q && qv) {
    // Semantic search: the browser embeds the query with the same model; plus a
    // boost for literal matches. Vectors are normalized, so inner product = cosine.
    rows = await sql`SELECT * FROM (
        SELECT id, site_id, title, url, published, first_seen, category, score, org, closing, status, status_by, assignee,
          -(embedding <#> ${vectorLiteral(queryVector(qv))}::vector)
            + CASE WHEN strpos(lower(title), ${q.toLowerCase()}) > 0 THEN 0.15 ELSE 0 END AS match
        FROM tenders WHERE ${cond} AND embedding IS NOT NULL) t
      WHERE match > 0.55 ORDER BY match DESC LIMIT 500`;
  } else {
    // Most software-relevant first; newest first among equal scores. Tenders the
    // team marked "Not relevant" (in Telegram) go last.
    rows = await sql`SELECT id, site_id, title, url, published, first_seen, category, score, org, closing, status, status_by, assignee
      FROM tenders WHERE ${cond}
      ORDER BY status IS NOT DISTINCT FROM 'not_relevant', score DESC NULLS LAST, COALESCE(published, left(first_seen, 10)) DESC, first_seen DESC
      LIMIT 500`;
  }
  const names = Object.fromEntries((await listSites()).map((s) => [s.id, s.name]));
  return rows.map((r) => ({ ...r, site: names[r.site_id] || r.site_id }));
}

/** Ministries and their divisions, from the government tenders we hold. */
async function orgs() {
  const tree = new Map();
  for (const { org } of await sql`SELECT DISTINCT org FROM tenders WHERE org IS NOT NULL AND site_id IN (SELECT id FROM sites WHERE section = 'gov')`) {
    const [ministry, second] = org.split(' › ');
    if (!tree.has(ministry)) tree.set(ministry, new Set());
    // A ministry's division ("Internal Resource Division"), not an office named "... PWD Division".
    if (second && /^[\w&'() -]{3,60} Division$/.test(second) && !/engineer|executive|director|office|circle|zone/i.test(second)) tree.get(ministry).add(second);
  }
  return [...tree].sort(([a], [b]) => a.localeCompare(b)).map(([ministry, divs]) => ({ ministry, divisions: [...divs].sort() }));
}

async function sites() {
  const st = Object.fromEntries((await sql`SELECT * FROM site_status`).map((r) => [r.site_id, r]));
  const counts = Object.fromEntries((await sql`
    SELECT site_id, COUNT(*)::int n, (COUNT(*) FILTER (WHERE category = 'software'))::int sw
    FROM tenders GROUP BY site_id`).map((r) => [r.site_id, r]));
  return (await listSites()).map((s) => ({ ...s, ...st[s.id], total: counts[s.id]?.n || 0, software: counts[s.id]?.sw || 0 }));
}

// Writes require a JSON body: browsers can't send that cross-site without a
// CORS preflight (which this API never approves), so other web pages
// can't add or remove sites behind your back.
async function readJson(req) {
  if (!/^application\/json\b/.test(req.headers.get('content-type') || '')) throw httpError(415, 'JSON body required');
  const raw = await req.text();
  if (raw.length > 10_000) throw httpError(413, 'body too large');
  return JSON.parse(raw || '{}');
}

async function handleAddSite(req) {
  const { name, url } = await readJson(req);
  let parsed;
  try { parsed = new URL(String(url || '').trim()); } catch { return json({ error: 'Enter a full link starting with http:// or https://' }, 400); }
  if (!/^https?:$/.test(parsed.protocol)) return json({ error: 'Only http:// and https:// links are supported' }, 400);
  if ((await sql`SELECT 1 FROM sites WHERE url = ${parsed.href}`).length) return json({ error: 'That link is already in the list' }, 409);
  const site = await addSite(String(name || '').trim().slice(0, 100), parsed.href);
  console.log(`site added: ${site.id} ${site.url}`);
  await triggerScrape([site.id]); // scrape it right away
  return json(site, 201);
}

export default async (req) => {
  try {
    const url = new URL(req.url);
    const path = url.pathname;
    if (req.method === 'GET' && path === '/api/tenders') return json(await listTenders(url.searchParams));
    if (req.method === 'GET' && path === '/api/sites') return json({ running: await isRunning(), sites: await sites() });
    if (req.method === 'GET' && path === '/api/orgs') return json(await orgs());
    if (req.method === 'POST' && path === '/api/sites') return await handleAddSite(req);
    if (req.method === 'DELETE' && path.startsWith('/api/sites/')) {
      await readJson(req);
      const id = decodeURIComponent(path.slice('/api/sites/'.length));
      if (!(await removeSite(id))) return json({ error: 'no such site' }, 404);
      console.log(`site removed: ${id}`);
      return json({ removed: id });
    }
    if (req.method === 'POST' && path === '/api/scrape') {
      await readJson(req);
      return json({ started: await triggerScrape(await allGroups()) }, 202);
    }
    return json({ error: 'not found' }, 404);
  } catch (err) {
    if (err.status) return json({ error: err.message }, err.status);
    if (err instanceof SyntaxError) return json({ error: 'invalid JSON' }, 400);
    console.error('request error:', err);
    return json({ error: String(err.message || err) }, 500);
  }
};

export const config = { path: '/api/*' };
