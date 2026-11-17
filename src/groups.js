// Scrape groups: 'banks' (every bank page), 'egp' and 'bppa' (the slow
// government sources, each in its own function run), or 'site:<id>' (one site,
// right after it is added). Each group fits in one 15-minute background function.
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
  const id = group.startsWith('site:') ? group.slice(5) : group;
  return sites.filter((s) => s.id === id);
}
