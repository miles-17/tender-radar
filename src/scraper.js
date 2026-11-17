// Scrapes one group (see groups.js) and classifies new tenders.
import { scrapeSite, BlockedError } from './fetch.js';
import { saveItems, setStatus, unclassified, saveClass, getSite } from './db.js';
import { classify } from './classify.js';
import { sitesFor } from './groups.js';

const CONCURRENCY = 6; // sites fetched at once within a group

async function scrapeOne(site, log) {
  try {
    const items = await scrapeSite(site);
    const current = await getSite(site.id);
    if (!current) return 0; // removed mid-scrape: don't resurrect its rows
    // First successful scrape of a site: what's already listed is old.
    const fresh = await saveItems(site.id, items, !current.baselined);
    await setStatus(site.id, { ok: true, found: items.length, newItems: fresh.length });
    log(`[${site.id}] ${items.length} found, ${fresh.length} new`);
    return fresh.length;
  } catch (err) {
    const blocked = err instanceof BlockedError;
    await setStatus(site.id, { ok: false, blocked, error: String(err.message || err).slice(0, 300) });
    log(`[${site.id}] ${blocked ? 'BLOCKED' : 'ERROR'}: ${err.message || err}`);
    return 0;
  }
}

/** Scrape one group's sites, then classify everything not yet classified. */
export async function scrapeGroup(group, log = console.log) {
  const t0 = Date.now();
  const queue = await sitesFor(group);
  let total = 0;
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let site; (site = queue.shift());) total += await scrapeOne(site, log);
  }));
  const todo = await unclassified();
  if (todo.length) {
    const res = await classify(todo);
    await saveClass(todo.map((p, i) => ({ id: p.id, ...res[i] })));
    const sw = res.filter((r) => r.category === 'software').length;
    log(`classified ${todo.length} (${sw} software)`);
  }
  log(`${group} done: ${total} new in ${Math.round((Date.now() - t0) / 1000)}s`);
}
