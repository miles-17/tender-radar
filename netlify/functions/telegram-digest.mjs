// Twice a day, 30 minutes after the scrape starts (every group has finished by
// then): post the software tenders first seen since the last digest to a
// Telegram group, grouped by institution, each title linking to its notice.
import { sql, isRunning } from '../../src/db.js';

const MAX_CHARS = 4000; // Telegram allows 4096 per message

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Messages (Telegram HTML) for these tenders: institutions with the most first. */
export function buildMessages(rows) {
  const byInst = new Map();
  for (const r of rows) {
    // Government tenders: the ministry, the first part of "Ministry › Division › ...".
    const inst = r.section === 'gov' && r.org ? r.org.split(' › ')[0] : r.site;
    if (!byInst.has(inst)) byInst.set(inst, []);
    byInst.get(inst).push(r);
  }
  const blocks = [...byInst].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([inst, list]) => [`<b>${esc(inst)}</b>: ${list.length} new`,
      ...list.map((r) => `• ${r.url ? `<a href="${esc(r.url)}">${esc(r.title)}</a>` : esc(r.title)}`)].join('\n'));

  const head = `<b>Tender Radar</b>: ${rows.length} new software tender${rows.length === 1 ? '' : 's'} from ${byInst.size} institution${byInst.size === 1 ? '' : 's'}`;
  const messages = [head];
  for (const block of blocks) {
    const last = messages.length - 1;
    if (messages[last].length + block.length + 2 <= MAX_CHARS) messages[last] += `\n\n${block}`;
    else messages.push(block.slice(0, MAX_CHARS)); // one institution never fills a message in practice
  }
  return messages;
}

async function send(text) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: process.env.TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', link_preview_options: { is_disabled: true } }),
  });
  const body = await res.json();
  if (!body.ok) throw new Error(`Telegram: ${body.description}`);
}

export default async () => {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    console.log('TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set; nothing sent');
    return;
  }
  // A scrape still running may have saved tenders it hasn't classified yet: wait for the next digest.
  if (await isRunning()) {
    console.log('a scrape is running; the next digest includes its tenders');
    return;
  }
  const now = new Date().toISOString();
  // The first run only starts the clock, so the group isn't flooded with old tenders.
  const since = (await sql`SELECT value FROM settings WHERE key = 'telegram_since'`)[0]?.value;
  if (since) {
    const rows = await sql`
      SELECT t.title, t.url, t.org, s.name AS site, s.section
      FROM tenders t JOIN sites s ON s.id = t.site_id
      WHERE t.category = 'software' AND t.first_seen > ${since} AND t.first_seen <= ${now}
      ORDER BY t.score DESC, t.first_seen DESC`;
    if (rows.length) for (const text of buildMessages(rows)) await send(text);
    console.log(`digest: ${rows.length} tenders since ${since}`);
  }
  // Only after every message went through, so a failed send is retried next time.
  await sql`INSERT INTO settings (key, value) VALUES ('telegram_since', ${now})
    ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
};

export const config = { schedule: '30 0,12 * * *' };
