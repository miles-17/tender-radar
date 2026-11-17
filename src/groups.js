// Scrape groups: 'banks' (every bank page), or one site's id: the slow
// government sources (egp, bppa) each get their own function run, and so does a
// site right after it is added. Each group fits in one 15-minute background function.
import { listSites } from './db.js';

const OWN_GROUP = new Set(['egp', 'bppa']); // site kinds scraped on their own

/** Groups for a full run. */
export async function allGroups() {
  const sites = await listSites();
  return ['banks', ...sites.filter((s) => OWN_GROUP.has(s.kind)).map((s) => s.id)];
}

export async function sitesFor(group) {
  const sites = await listSites();
  if (group === 'banks') return sites.filter((s) => !OWN_GROUP.has(s.kind));
  return sites.filter((s) => s.id === group);
}
