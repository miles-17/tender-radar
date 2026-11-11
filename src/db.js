import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.TENDER_DB || join(ROOT, 'data', 'tenders.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA busy_timeout = 5000;
  CREATE TABLE IF NOT EXISTS tenders (
    id          TEXT PRIMARY KEY,          -- sha1(site|url|title)
    site_id     TEXT NOT NULL,
    title       TEXT NOT NULL,
    url         TEXT,
    published   TEXT,                      -- YYYY-MM-DD when found on page
    context     TEXT,
    first_seen  TEXT NOT NULL,
    last_seen   TEXT NOT NULL,
    category    TEXT,                      -- software | it | other
    score       REAL,                      -- software relevance, 0..1
    embedding   BLOB                       -- Float32Array, 384 dims
  );
  CREATE INDEX IF NOT EXISTS tenders_site ON tenders(site_id);
  CREATE INDEX IF NOT EXISTS tenders_cat ON tenders(category, score);
  CREATE TABLE IF NOT EXISTS site_status (
    site_id     TEXT PRIMARY KEY,
    last_run    TEXT,
    ok          INTEGER,
    blocked     INTEGER,
    found       INTEGER,
    new_items   INTEGER,
    error       TEXT
  );
  CREATE TABLE IF NOT EXISTS sites (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    url         TEXT NOT NULL UNIQUE,
    kind        TEXT NOT NULL DEFAULT 'auto', -- html | json | rupali | auto
    scope       TEXT,
    added       TEXT NOT NULL
  );
`);

// First start: seed the editable site list from the built-in bank list.
if (!db.prepare('SELECT COUNT(*) n FROM sites').get().n) {
  const { SITES } = await import('./sites.js');
  const seed = db.prepare('INSERT INTO sites (id, name, url, kind, scope, added) VALUES (?, ?, ?, ?, ?, ?)');
  const now = new Date().toISOString();
  for (const s of SITES) seed.run(s.id, s.name, s.url, s.kind, s.scope ?? null, now);
}

export const listSites = () => db.prepare('SELECT * FROM sites ORDER BY added, rowid').all();
export const getSite = (id) => db.prepare('SELECT * FROM sites WHERE id = ?').get(id);

export function addSite(name, url) {
  const host = new URL(url).hostname.replace(/^www\./, '');
  const id = `${host.split('.')[0].replace(/[^a-z0-9]/gi, '').toLowerCase() || 'site'}-${createHash('sha1').update(url).digest('hex').slice(0, 6)}`;
  db.prepare("INSERT INTO sites (id, name, url, kind, added) VALUES (?, ?, ?, 'auto', ?)")
    .run(id, name || host, url, new Date().toISOString());
  return getSite(id);
}

/** Remove a site and everything scraped from it. */
export function removeSite(id) {
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM tenders WHERE site_id = ?').run(id);
    db.prepare('DELETE FROM site_status WHERE site_id = ?').run(id);
    const { changes } = db.prepare('DELETE FROM sites WHERE id = ?').run(id);
    db.exec('COMMIT');
    return changes > 0;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const tenderId = (siteId, it) =>
  createHash('sha1').update(`${siteId}|${it.url || ''}|${it.title.toLowerCase()}`).digest('hex');

const insert = db.prepare(`
  INSERT INTO tenders (id, site_id, title, url, published, context, first_seen, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET last_seen = excluded.last_seen,
    published = COALESCE(tenders.published, excluded.published)`);
const exists = db.prepare('SELECT 1 FROM tenders WHERE id = ?');

/** Upsert scraped items; returns ids of items not seen before. */
export function saveItems(siteId, items) {
  const now = new Date().toISOString();
  const fresh = [];
  db.exec('BEGIN');
  try {
    for (const it of items) {
      const id = tenderId(siteId, it);
      if (!exists.get(id)) fresh.push(id);
      insert.run(id, siteId, it.title, it.url, it.published, it.context, now, now);
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  return fresh;
}

const status = db.prepare(`
  INSERT INTO site_status (site_id, last_run, ok, blocked, found, new_items, error)
  VALUES (?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(site_id) DO UPDATE SET last_run = excluded.last_run, ok = excluded.ok,
    blocked = excluded.blocked, found = excluded.found, new_items = excluded.new_items, error = excluded.error`);
export const setStatus = (siteId, s) =>
  status.run(siteId, new Date().toISOString(), s.ok ? 1 : 0, s.blocked ? 1 : 0, s.found ?? 0, s.newItems ?? 0, s.error ?? null);

export const unclassified = () => db.prepare('SELECT id, title, context FROM tenders WHERE embedding IS NULL').all();
const setClass = db.prepare('UPDATE tenders SET category = ?, score = ?, embedding = ? WHERE id = ?');
export const saveClass = (id, category, score, vec) =>
  setClass.run(category, score, Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength), id);
