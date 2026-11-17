// Starts scrape-background function runs. Each group is claimed first, so a
// group already running isn't started twice.
import { claimRun } from './db.js';

export async function triggerScrape(groups) {
  const base = process.env.URL; // the site's main URL, set by Netlify
  const key = process.env.SCRAPE_KEY;
  if (!base || !key) throw new Error('URL and SCRAPE_KEY must be set');
  const started = [];
  for (const group of groups) {
    if (!(await claimRun(group))) continue;
    const res = await fetch(new URL('/.netlify/functions/scrape-background', base), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-scrape-key': key },
      body: JSON.stringify({ group }),
    });
    if (res.status !== 202) throw new Error(`scrape-background answered HTTP ${res.status}`);
    started.push(group);
  }
  return started;
}
