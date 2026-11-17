// Telegram webhook (set up by scripts/setup-telegram.mjs): the group's commands
// and button presses. A background function, so Telegram gets its answer at
// once while /search and /watch load the embedding model.
// Only the team group is served; anything from other chats is ignored.
import { timingSafeEqual } from 'node:crypto';
import { sql, vectorLiteral } from '../../src/db.js';
import { embedText } from '../../src/classify.js';
import { allGroups } from '../../src/groups.js';
import { triggerScrape } from '../../src/trigger.js';
import { call, send, sendTenders, keyboard, keyboardTenders, chatId, enabled, webhookSecret, esc, TENDER_COLS } from '../../src/telegram.js';

const HELP = `<b>Scrappy</b> posts new software tenders here after each scrape (6 am and 6 pm), with buttons to mark each one.

/latest: the 10 newest software tenders
/search <i>words</i>: the 5 best matches, by meaning
/bank <i>name</i>: an institution's recent software tenders
/watch <i>phrase</i>: post matching tenders as soon as they're found
/unwatch <i>phrase</i>: stop watching it
/watches: the phrases being watched
/scrape: scrape every site now
/help: this list`;

const sameSecret = (a, b) => {
  const [x, y] = [Buffer.from(a), Buffer.from(b)];
  return x.length === y.length && timingSafeEqual(x, y);
};
const who = (u) => [u.first_name, u.last_name].filter(Boolean).join(' ').slice(0, 40) || u.username || 'someone';

let botName;
const myName = async () => (botName ??= (await call('getMe', {})).username.toLowerCase());

const COMMANDS = {
  async help() { return HELP; },
  start() { return HELP; },

  async latest(_, reply) {
    const rows = await sql`SELECT ${sql.unsafe(TENDER_COLS)} FROM tenders t JOIN sites s ON s.id = t.site_id
      WHERE t.category = 'software' AND t.status IS DISTINCT FROM 'not_relevant' ORDER BY t.first_seen DESC, t.score DESC LIMIT 10`;
    if (!rows.length) return 'No software tenders yet.';
    await sendTenders(rows, '<b>Newest software tenders</b>', {}, reply);
  },

  async search(q, reply) {
    if (!q) return 'Add what to look for, like <code>/search core banking</code>.';
    const v = vectorLiteral(await embedText(q));
    // Same ranking as the dashboard search: meaning, plus a boost for the words themselves.
    const rows = await sql`SELECT * FROM (
        SELECT ${sql.unsafe(TENDER_COLS)}, -(t.embedding <#> ${v}::vector)
          + CASE WHEN strpos(lower(t.title), ${q.toLowerCase()}) > 0 THEN 0.15 ELSE 0 END AS match
        FROM tenders t JOIN sites s ON s.id = t.site_id WHERE t.embedding IS NOT NULL) x
      WHERE match > 0.55 ORDER BY match DESC LIMIT 5`;
    if (!rows.length) return `Nothing matches “${esc(q)}”.`;
    await sendTenders(rows, `<b>Best matches for “${esc(q)}”</b>`, {}, reply);
  },

  async bank(q, reply) {
    if (!q) return 'Add a name, like <code>/bank City</code> or <code>/bank Finance</code>.';
    const like = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const rows = await sql`SELECT ${sql.unsafe(TENDER_COLS)} FROM tenders t JOIN sites s ON s.id = t.site_id
      WHERE t.category = 'software' AND (
        (s.section = 'bank' AND s.name ILIKE ${like}) OR (s.section = 'gov' AND split_part(t.org, ' › ', 1) ILIKE ${like}))
      ORDER BY t.first_seen DESC LIMIT 10`;
    if (!rows.length) return `No software tenders from an institution matching “${esc(q)}”.`;
    await sendTenders(rows, `<b>Recent software tenders: “${esc(q)}”</b>`, {}, reply);
  },

  async watch(q, _, from) {
    if (!q) return COMMANDS.watches();
    const phrase = q.toLowerCase().slice(0, 100);
    await sql`INSERT INTO watches (phrase, embedding, added_by) VALUES (${phrase}, ${vectorLiteral(await embedText(phrase))}::vector, ${who(from)})
      ON CONFLICT (phrase) DO NOTHING`;
    return `Watching “${esc(phrase)}”: matching tenders will be posted here as soon as a scrape finds them.`;
  },

  async unwatch(q) {
    if (!q) return 'Add the phrase, like <code>/unwatch payment gateway</code>. /watches lists them.';
    const gone = (await sql`DELETE FROM watches WHERE phrase = ${q.toLowerCase()}`).count;
    return gone ? `Stopped watching “${esc(q.toLowerCase())}”.` : `“${esc(q)}” isn't being watched. /watches lists the phrases.`;
  },

  async watches() {
    const rows = await sql`SELECT phrase, added_by FROM watches ORDER BY phrase`;
    if (!rows.length) return 'Nothing is being watched. Add a phrase with <code>/watch payment gateway</code>.';
    return `<b>Watching</b>\n${rows.map((r) => `• ${esc(r.phrase)}${r.added_by ? ` <i>(${esc(r.added_by)})</i>` : ''}`).join('\n')}`;
  },

  async scrape(_, __, from) {
    const started = await triggerScrape(await allGroups());
    if (!started.length) return 'A scrape is already running. New tenders will be posted here when it finishes.';
    await sql`INSERT INTO settings (key, value) VALUES ('scrape_asked', ${who(from)}) ON CONFLICT (key) DO UPDATE SET value = excluded.value`;
    return 'Scraping every site now. New software tenders will be posted here when it finishes, in about 10 minutes.';
  },
};

async function onMessage(msg) {
  const m = /^\/(\w+)(?:@(\w+))?(?:\s+([\s\S]*))?$/.exec(msg.text || '');
  if (!m) return;
  const [, name, to, arg = ''] = m;
  if (to && to.toLowerCase() !== (await myName())) return; // meant for another bot
  const command = COMMANDS[name.toLowerCase()];
  if (!command) return;
  const reply = { reply_parameters: { message_id: msg.message_id, allow_sending_without_reply: true } };
  try {
    const text = await command(arg.trim(), reply, msg.from);
    if (text) await send(text, reply);
  } catch (err) {
    console.error(`/${name} failed:`, err);
    await send(`Sorry, /${esc(name)} failed: ${esc(err.message || err)}`, reply);
  }
}

// A button under a tender: b = We'll bid, n = Not relevant, m = Take it. Pressing
// the chosen one again clears it. The pressed message's buttons are redrawn.
async function onButton(q) {
  const [act, n, id] = (q.data || '').split(':');
  const name = who(q.from);
  const [t] = await sql`SELECT status, assignee FROM tenders WHERE id = ${id}`;
  if (!t || !['b', 'n', 'm'].includes(act)) return call('answerCallbackQuery', { callback_query_id: q.id, text: 'This tender is no longer in Tender Radar.' });
  let toast;
  if (act === 'm') {
    const assignee = t.assignee === name ? null : name;
    await sql`UPDATE tenders SET assignee = ${assignee}, marked_at = now() WHERE id = ${id}`;
    toast = assignee ? `#${n}: taken by ${name}` : `#${n}: no longer taken`;
  } else {
    const want = act === 'b' ? 'bid' : 'not_relevant';
    const status = t.status === want ? null : want;
    await sql`UPDATE tenders SET status = ${status}, status_by = ${name}, marked_at = now() WHERE id = ${id}`;
    toast = status ? `#${n} marked “${status === 'bid' ? "We'll bid" : 'Not relevant'}” by ${name}` : `#${n}: mark cleared`;
  }
  await call('answerCallbackQuery', { callback_query_id: q.id, text: toast });
  const listed = keyboardTenders(q.message.reply_markup);
  const now = Object.fromEntries((await sql`SELECT ${sql.unsafe(TENDER_COLS)} FROM tenders t JOIN sites s ON s.id = t.site_id
    WHERE t.id = ANY(${listed.map(([, i]) => i)})`).map((r) => [r.id, r]));
  await call('editMessageReplyMarkup', {
    chat_id: q.message.chat.id, message_id: q.message.message_id,
    reply_markup: keyboard(listed.filter(([, i]) => now[i]).map(([k, i]) => [k, now[i]])),
  }).catch((err) => { if (!/not modified/.test(err.message)) throw err; });
}

export default async (req) => {
  if (!enabled() || !sameSecret(req.headers.get('x-telegram-bot-api-secret-token') || '', webhookSecret())) {
    return new Response('forbidden', { status: 403 });
  }
  const update = await req.json();
  const chat = String((update.message || update.callback_query?.message)?.chat?.id);
  if (chat !== String(chatId())) return; // not the team group
  try {
    if (update.callback_query) await onButton(update.callback_query);
    else if (update.message) await onMessage(update.message);
  } catch (err) {
    console.error('update failed:', err);
  }
};
