// Background function (up to 15 minutes): scrapes one group. Started by
// src/trigger.js, which has already marked the group as running.
import { timingSafeEqual } from 'node:crypto';
import { scrapeGroup } from '../../src/scraper.js';
import { finishRun, isRunning } from '../../src/db.js';
import { sendDigest } from '../../src/notify.js';

const sameKey = (a, b) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
};

export default async (req) => {
  const key = process.env.SCRAPE_KEY;
  if (!key || !sameKey(req.headers.get('x-scrape-key') || '', key)) return new Response('forbidden', { status: 403 });
  const { group } = await req.json();
  const log = (...a) => console.log(new Date().toISOString(), ...a);
  try {
    await scrapeGroup(String(group), log);
  } catch (err) {
    log(`${group} failed:`, err);
  } finally {
    await finishRun(String(group));
  }
  // The last group to finish posts the Telegram digest of what the scrape found.
  if (!(await isRunning())) await sendDigest().catch((err) => log('digest failed:', err));
};
