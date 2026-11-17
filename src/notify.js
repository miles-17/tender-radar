// Messages Scrappy posts to the Telegram group on its own: the digest after
// each scrape, /watch alerts, site problems, deadline reminders and the
// weekly summary. All do nothing until TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID are set.
import { sql } from './db.js';
import { enabled, send, sendTenders, esc, institution, dhakaDate, fmtDay, TENDER_COLS } from './telegram.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const setting = async (key) => (await sql`SELECT value FROM settings WHERE key = ${key}`)[0]?.value;

/**
 * Software tenders first seen since the last digest, grouped by institution.
 * Called when a scrape ends with no other group still running.
 */
export async function sendDigest() {
  if (!enabled()) return;
  const now = new Date().toISOString();
  const since = await setting('telegram_since');
  if (!since) { // first run only starts the clock, so the group isn't flooded with old tenders
    await sql`INSERT INTO settings (key, value) VALUES ('telegram_since', ${now}) ON CONFLICT DO NOTHING`;
    return;
  }
  // Claim the window: of two scrape groups ending together, only one sends it.
  if (!(await sql`UPDATE settings SET value = ${now} WHERE key = 'telegram_since' AND value = ${since} RETURNING 1`).length) return;
  try {
    const rows = await sql`
      SELECT ${sql.unsafe(TENDER_COLS)} FROM tenders t JOIN sites s ON s.id = t.site_id
      WHERE t.category = 'software' AND t.first_seen > ${since} AND t.first_seen <= ${now}
      ORDER BY t.score DESC, t.first_seen DESC`;
    // Someone asked for this scrape with /scrape: tell them it finished even when nothing is new.
    const asked = (await sql`DELETE FROM settings WHERE key = 'scrape_asked' RETURNING value`)[0]?.value;
    if (rows.length) {
      const n = new Set(rows.map(institution)).size;
      await sendTenders(rows, `<b>Tender Radar</b>: ${plural(rows.length, 'new software tender')} from ${plural(n, 'institution')}`, { group: true });
    } else if (asked) {
      await send(`Scrape finished: no new software tenders since the last digest.`);
    }
    console.log(`digest: ${rows.length} tenders since ${since}`);
  } catch (err) {
    // Give the window back, so the next digest retries it.
    await sql`UPDATE settings SET value = ${since} WHERE key = 'telegram_since' AND value = ${now}`;
    throw err;
  }
}

// A tender counts as matching a watch at this similarity (same measure as the
// dashboard search, which lists anything above 0.55; alerts need to be surer).
const WATCH_MATCH = 0.7;

/** Post newly classified tenders that match a /watch phrase. */
export async function watchAlerts(ids) {
  if (!enabled() || !ids.length) return;
  const rows = await sql`
    SELECT w.phrase, ${sql.unsafe(TENDER_COLS)} FROM watches w
    JOIN tenders t ON t.id = ANY(${ids}) JOIN sites s ON s.id = t.site_id
    WHERE -(t.embedding <#> w.embedding) + CASE WHEN strpos(lower(t.title), w.phrase) > 0 THEN 0.15 ELSE 0 END > ${WATCH_MATCH}
    ORDER BY w.phrase, t.score DESC`;
  const byPhrase = Map.groupBy(rows, (r) => r.phrase);
  for (const [phrase, list] of byPhrase) await sendTenders(list, `🔔 <b>Watch “${esc(phrase)}”</b>: ${plural(list.length, 'new tender')}`);
}

/** Sites that just failed 3 scrapes in a row, and ones working again after that. */
export async function siteAlerts(failing, recovered) {
  if (!enabled() || !(failing.length || recovered.length)) return;
  const parts = [];
  if (failing.length) parts.push(`⚠️ <b>Failed 3 scrapes in a row</b>\n${failing.map((f) => `• ${esc(f.name)}: ${esc(f.error)}`).join('\n')}`);
  if (recovered.length) parts.push(`✅ <b>Working again</b>\n${recovered.map((f) => `• ${esc(f.name)}`).join('\n')}`);
  await send(parts.join('\n\n'));
}

/** Daily: tenders the team is bidding on or has taken that close today, tomorrow or in 3 days. */
export async function sendReminders() {
  if (!enabled()) return;
  const day = (n) => dhakaDate(new Date(Date.now() + n * 86400_000));
  const when = { [day(0)]: 'Closes today', [day(1)]: 'Closes tomorrow', [day(3)]: 'Closes in 3 days' };
  const rows = await sql`
    SELECT ${sql.unsafe(TENDER_COLS)} FROM tenders t JOIN sites s ON s.id = t.site_id
    WHERE t.closing = ANY(${Object.keys(when)}) AND (t.status = 'bid' OR (t.assignee IS NOT NULL AND t.status IS DISTINCT FROM 'not_relevant'))
    ORDER BY t.closing`;
  if (!rows.length) return;
  const lines = rows.map((r) => `<b>${when[r.closing]}</b> (${fmtDay(r.closing)}): ${r.url ? `<a href="${esc(r.url)}">${esc(r.title)}</a>` : esc(r.title)}\n<i>${[esc(institution(r)), r.assignee && `taken by ${esc(r.assignee)}`].filter(Boolean).join(' · ')}</i>`);
  await send(`⏰ <b>Deadlines</b>\n\n${lines.join('\n\n')}`);
}

/** Sunday: the week's software tenders, the team's decisions, and sites with problems. */
export async function sendWeekly() {
  if (!enabled()) return;
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString();
  const today = dhakaDate();
  const fresh = await sql`
    SELECT ${sql.unsafe(TENDER_COLS)} FROM tenders t JOIN sites s ON s.id = t.site_id
    WHERE t.category = 'software' AND t.first_seen > ${weekAgo} ORDER BY t.score DESC`;
  const [marks] = await sql`SELECT
      (COUNT(*) FILTER (WHERE status = 'bid'))::int AS bid,
      (COUNT(*) FILTER (WHERE status = 'not_relevant'))::int AS dropped,
      (COUNT(*) FILTER (WHERE assignee IS NOT NULL))::int AS taken
    FROM tenders WHERE marked_at > ${weekAgo}`;
  const bidding = await sql`
    SELECT ${sql.unsafe(TENDER_COLS)} FROM tenders t JOIN sites s ON s.id = t.site_id
    WHERE t.status = 'bid' AND (t.closing IS NULL OR t.closing >= ${today}) ORDER BY t.closing NULLS LAST`;
  const broken = await sql`SELECT s.name FROM site_status st JOIN sites s ON s.id = st.site_id WHERE NOT st.ok ORDER BY s.pos`;

  const counts = [...Map.groupBy(fresh, institution)].map(([k, v]) => [k, v.length]).sort((a, b) => b[1] - a[1]);
  const link = (r) => (r.url ? `<a href="${esc(r.url)}">${esc(r.title)}</a>` : esc(r.title));
  const parts = [`📋 <b>Tender Radar: the week</b>\n${plural(fresh.length, 'new software tender')} from ${plural(counts.length, 'institution')}`];
  if (counts.length) parts.push(`<b>Most tenders</b>\n${counts.slice(0, 5).map(([k, n]) => `• ${esc(k)}: ${n}`).join('\n')}`);
  if (fresh.length) parts.push(`<b>Most relevant</b>\n${fresh.slice(0, 5).map((r, i) => `${i + 1}. ${link(r)}\n<i>${esc(institution(r))}</i>`).join('\n')}`);
  parts.push(`<b>Team this week</b>: ${marks.bid} marked “We'll bid”, ${marks.dropped} “Not relevant”, ${marks.taken} taken`);
  if (bidding.length) {
    parts.push(`<b>Bidding on</b>\n${bidding.slice(0, 10).map((r) => `• ${link(r)}\n<i>${[r.closing && `closes ${fmtDay(r.closing)}`, r.assignee && `taken by ${esc(r.assignee)}`].filter(Boolean).join(' · ') || esc(institution(r))}</i>`).join('\n')}`);
  }
  if (broken.length) parts.push(`<b>Sites not scraping</b>: ${broken.map((b) => esc(b.name)).join(', ')}`);
  // Several messages if needed; each part is well under Telegram's 4096 characters.
  const messages = [''];
  for (const p of parts) {
    if (messages.at(-1).length + p.length > 4000) messages.push('');
    messages[messages.length - 1] += `${messages.at(-1) ? '\n\n' : ''}${p}`;
  }
  for (const m of messages) await send(m);
}
