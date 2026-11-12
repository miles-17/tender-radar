// Entry point: web dashboard + scrape loop.
//   node src/main.js          run forever (server + scrape every SCRAPE_HOURS)
//   node src/main.js --once   one scrape run, then exit
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db, listSites, addSite, removeSite } from './db.js';
import { runAll, runSites, isRunning } from './scraper.js';
import { embedQuery } from './classify.js';

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8642);
const SCRAPE_HOURS = Number(process.env.SCRAPE_HOURS || 3);
const log = (...a) => console.log(new Date().toISOString(), ...a);

if (process.argv.includes('--once')) {
  await runAll(log);
  process.exit(0);
}

const INDEX = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'index.html');

const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; };
const toVec = (buf) => new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);

async function listTenders(params) {
  const where = [];
  const args = [];
  // Section: bank tender pages or ministries & departments (government sources).
  where.push('site_id IN (SELECT id FROM sites WHERE section = ?)');
  args.push(params.get('section') === 'gov' ? 'gov' : 'bank');
  // Ministry, or "Ministry › Division": matches that org and everything under it.
  const org = params.get('org');
  if (org) { where.push("(org = ? OR substr(org, 1, length(?) + 3) = ? || ' › ')"); args.push(org, org, org); }
  const cat = params.get('category') || 'software';
  if (cat !== 'all') { where.push('category = ?'); args.push(cat); }
  const site = params.get('site');
  if (site) { where.push('site_id = ?'); args.push(site); }
  // Date filters use the date on the bank's page, else the day we first saw it.
  const DAY = "COALESCE(published, substr(first_seen, 1, 10))";
  const sinceDays = Number(params.get('days') || 0);
  if (sinceDays > 0) {
    where.push(`${DAY} >= date('now', ?)`);
    args.push(`-${sinceDays} days`);
  }
  // Custom range: from/to are inclusive YYYY-MM-DD; either may be left open.
  // Matches the page date only: undated tenders all share the day of the first
  // scrape, so a first_seen fallback would flood any range covering that day.
  for (const [key, op] of [['from', '>='], ['to', '<=']]) {
    const d = params.get(key);
    if (!d) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw Object.assign(new Error(`${key} must be YYYY-MM-DD`), { status: 400 });
    where.push(`published ${op} ?`);
    args.push(d);
  }
  const q = (params.get('q') || '').trim();
  // Most software-relevant first; newest first among equal scores.
  const sql = `SELECT id, site_id, title, url, published, first_seen, category, score, org${q ? ', embedding' : ''}
    FROM tenders ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY score DESC, COALESCE(published, substr(first_seen, 1, 10)) DESC, first_seen DESC`;
  let rows = db.prepare(sql).all(...args);
  if (q) {
    // Semantic search with the embedding model, plus a boost for literal matches.
    const qv = await embedQuery(q);
    const needle = q.toLowerCase();
    rows = rows
      .filter((r) => r.embedding)
      .map((r) => ({ ...r, match: dot(qv, toVec(r.embedding)) + (r.title.toLowerCase().includes(needle) ? 0.15 : 0) }))
      .filter((r) => r.match > 0.55)
      .sort((a, b) => b.match - a.match);
  }
  const names = Object.fromEntries(listSites().map((s) => [s.id, s.name]));
  return rows.slice(0, 500).map(({ embedding, ...r }) => ({ ...r, site: names[r.site_id] || r.site_id }));
}

/** Ministries and their divisions, from the government tenders we hold. */
function orgs() {
  const tree = new Map();
  for (const { org } of db.prepare("SELECT DISTINCT org FROM tenders WHERE org IS NOT NULL AND site_id IN (SELECT id FROM sites WHERE section = 'gov')").all()) {
    const [ministry, second] = org.split(' › ');
    if (!tree.has(ministry)) tree.set(ministry, new Set());
    // A ministry's division ("Internal Resource Division"), not an office named "... PWD Division".
    if (second && /^[\w&'() -]{3,60} Division$/.test(second) && !/engineer|executive|director|office|circle|zone/i.test(second)) tree.get(ministry).add(second);
  }
  return [...tree].sort(([a], [b]) => a.localeCompare(b)).map(([ministry, divs]) => ({ ministry, divisions: [...divs].sort() }));
}

function sites() {
  const st = Object.fromEntries(db.prepare('SELECT * FROM site_status').all().map((r) => [r.site_id, r]));
  const counts = Object.fromEntries(db.prepare(
    "SELECT site_id, COUNT(*) n, SUM(category = 'software') sw FROM tenders GROUP BY site_id").all().map((r) => [r.site_id, r]));
  return listSites().map((s) => ({ ...s, ...st[s.id], total: counts[s.id]?.n || 0, software: counts[s.id]?.sw || 0 }));
}

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

// Writes require a JSON body: browsers can't send that cross-site without a
// CORS preflight (which this server never approves), so other web pages
// can't add or remove sites behind your back.
async function readJson(req) {
  if (!/^application\/json\b/.test(req.headers['content-type'] || '')) throw Object.assign(new Error('JSON body required'), { status: 415 });
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 10_000) throw Object.assign(new Error('body too large'), { status: 413 }); }
  return JSON.parse(raw || '{}');
}

async function handleAddSite(req, res) {
  const { name, url } = await readJson(req);
  let parsed;
  try { parsed = new URL(String(url || '').trim()); } catch { return send(res, 400, { error: 'Enter a full link starting with http:// or https://' }); }
  if (!/^https?:$/.test(parsed.protocol)) return send(res, 400, { error: 'Only http:// and https:// links are supported' });
  if (db.prepare('SELECT 1 FROM sites WHERE url = ?').get(parsed.href)) return send(res, 409, { error: 'That link is already in the list' });
  const site = addSite(String(name || '').trim().slice(0, 100), parsed.href);
  log(`site added: ${site.id} ${site.url}`);
  runSites([site], log); // scrape it right away
  return send(res, 201, site);
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const path = url.pathname;
    if (req.method === 'GET' && path === '/') return send(res, 200, readFileSync(INDEX), 'text/html');
    if (req.method === 'GET' && path === '/api/tenders') return send(res, 200, await listTenders(url.searchParams));
    if (req.method === 'GET' && path === '/api/sites') return send(res, 200, { running: isRunning(), sites: sites() });
    if (req.method === 'GET' && path === '/api/orgs') return send(res, 200, orgs());
    if (req.method === 'POST' && path === '/api/sites') return await handleAddSite(req, res);
    if (req.method === 'DELETE' && path.startsWith('/api/sites/')) {
      await readJson(req);
      const id = decodeURIComponent(path.slice('/api/sites/'.length));
      if (!removeSite(id)) return send(res, 404, { error: 'no such site' });
      log(`site removed: ${id}`);
      return send(res, 200, { removed: id });
    }
    if (req.method === 'POST' && path === '/api/scrape') {
      await readJson(req);
      runAll(log);
      return send(res, 202, { started: true });
    }
    send(res, 404, { error: 'not found' });
  } catch (err) {
    if (err.status) return send(res, err.status, { error: err.message });
    if (err instanceof SyntaxError) return send(res, 400, { error: 'invalid JSON' });
    log('request error:', err);
    send(res, 500, { error: String(err.message || err) });
  }
}).listen(PORT, HOST, () => log(`dashboard on http://${HOST}:${PORT}  (scraping every ${SCRAPE_HOURS}h)`));

runAll(log);
setInterval(() => runAll(log), SCRAPE_HOURS * 3600_000);
