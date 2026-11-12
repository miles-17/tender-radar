import { scrapeSite, BlockedError } from './fetch.js';
import { saveItems, setStatus, unclassified, saveClass, listSites, getSite } from './db.js';
import { classify } from './classify.js';

let queue = Promise.resolve();
let pending = 0;
export const isRunning = () => pending > 0;

async function scrape(sites, log) {
  const t0 = Date.now();
  let total = 0;
  for (const site of sites) {
    if (!getSite(site.id)) continue; // removed while queued
    try {
      const items = await scrapeSite(site);
      const current = getSite(site.id);
      if (!current) continue; // removed mid-scrape: don't resurrect its rows
      // First successful scrape of a site: what's already listed is old.
      const fresh = saveItems(site.id, items, !current.baselined);
      total += fresh.length;
      setStatus(site.id, { ok: true, found: items.length, newItems: fresh.length });
      log(`[${site.id}] ${items.length} found, ${fresh.length} new`);
    } catch (err) {
      const blocked = err instanceof BlockedError;
      setStatus(site.id, { ok: false, blocked, error: String(err.message || err).slice(0, 300) });
      log(`[${site.id}] ${blocked ? 'BLOCKED' : 'ERROR'}: ${err.message || err}`);
    }
  }
  const todo = unclassified();
  if (todo.length) {
    const res = await classify(todo);
    todo.forEach((p, i) => saveClass(p.id, res[i].category, res[i].score, res[i].vec));
    const sw = res.filter((r) => r.category === 'software').length;
    log(`classified ${todo.length} (${sw} software)`);
  }
  log(`run done: ${total} new in ${Math.round((Date.now() - t0) / 1000)}s`);
}

/** Queue a scrape of the given sites (default: all). Runs never overlap. */
export function runSites(sites, log = console.log) {
  pending++;
  queue = queue
    .then(() => scrape(sites ?? listSites(), log))
    .catch((e) => log('run failed:', e))
    .finally(() => { pending--; });
  return queue;
}

/** Full run; skipped if one is already queued or running. */
export function runAll(log = console.log) {
  return isRunning() ? queue : runSites(null, log);
}
