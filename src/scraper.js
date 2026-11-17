// Scrapes one group (see groups.js) and classifies new tenders.
import { scrapeSite, BlockedError } from './fetch.js';
import { saveItems, setStatus, unclassified, saveClass, getSite, feedback } from './db.js';
import { classify } from './classify.js';
import { sitesFor } from './groups.js';
import { watchAlerts, siteAlerts } from './notify.js';

const CONCURRENCY = 6; // sites fetched at once within a group
const ALERT_AFTER = 3; // failed scrapes in a row before the group hears about it

async function scrapeOne(site, log, alerts) {
  try {
    const items = await scrapeSite(site);
    const current = await getSite(site.id);
    if (!current) return 0; // removed mid-scrape: don't resurrect its rows
    // First successful scrape of a site: what's already listed is old.
    const fresh = await saveItems(site.id, items, !current.baselined);
    const { was } = await setStatus(site.id, { ok: true, found: items.length, newItems: fresh.length });
    if (was >= ALERT_AFTER) alerts.recovered.push(site);
    log(`[${site.id}] ${items.length} found, ${fresh.length} new`);
    return fresh.length;
  } catch (err) {
    const blocked = err instanceof BlockedError;
    const error = String(err.message || err).slice(0, 300);
    const { fails } = await setStatus(site.id, { ok: false, blocked, error });
    if (fails === ALERT_AFTER) alerts.failing.push({ ...site, error });
    log(`[${site.id}] ${blocked ? 'BLOCKED' : 'ERROR'}: ${err.message || err}`);
    return 0;
  }
}

/** Scrape one group's sites, then classify everything not yet classified. */
export async function scrapeGroup(group, log = console.log) {
  const t0 = Date.now();
  const queue = await sitesFor(group);
  let total = 0;
  const alerts = { failing: [], recovered: [] };
  await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    for (let site; (site = queue.shift());) total += await scrapeOne(site, log, alerts);
  }));
  await siteAlerts(alerts.failing, alerts.recovered).catch((err) => log('site alert failed:', err.message));
  const todo = await unclassified();
  if (todo.length) {
    const res = await classify(todo, await feedback());
    const mine = await saveClass(todo.map((p, i) => ({ id: p.id, ...res[i] })));
    const sw = res.filter((r) => r.category === 'software').length;
    log(`classified ${todo.length} (${sw} software)`);
    await watchAlerts(mine).catch((err) => log('watch alert failed:', err.message));
  }
  log(`${group} done: ${total} new in ${Math.round((Date.now() - t0) / 1000)}s`);
}
