// Telegram Bot API and the tender lists the bot posts: numbered lines, each
// with a row of buttons (We'll bid / Not relevant / Take it) whose state is
// saved on the tender, so the dashboard shows it too.
import { createHmac } from 'node:crypto';

export const chatId = () => process.env.TELEGRAM_CHAT_ID;
export const enabled = () => Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

/** Secret Telegram sends with every webhook call (derived, so there is no extra variable to set). */
export const webhookSecret = () => createHmac('sha256', process.env.SCRAPE_KEY || '').update('telegram-webhook').digest('hex');

export async function call(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const out = await res.json();
  if (!out.ok) throw new Error(`Telegram ${method}: ${out.description}`);
  return out.result;
}

/** Post HTML text to the group (or reply to a message there). */
export const send = (text, extra = {}) =>
  call('sendMessage', { chat_id: chatId(), text, parse_mode: 'HTML', link_preview_options: { is_disabled: true }, ...extra });

export const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Government tenders: the ministry (first part of "Ministry › Division › ..."); else the bank. */
export const institution = (r) => (r.section === 'gov' && r.org ? r.org.split(' › ')[0] : r.site);

/** Today in Dhaka, YYYY-MM-DD. */
export const dhakaDate = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(d);

export const fmtDay = (ymd) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** Columns every tender list needs (with sites joined as s). */
export const TENDER_COLS = 't.id, t.title, t.url, t.org, t.closing, t.status, t.assignee, s.name AS site, s.section';

const MAX_CHARS = 4000; // Telegram allows 4096 per message
const MAX_ITEMS = 25;   // three buttons each, Telegram allows 100 per message

/** Buttons for one tender, showing its current decision. Callback data: action:number:tender id. */
function buttonRow(n, t) {
  return [
    { text: `${n} ${t.status === 'bid' ? '✅' : '·'} We'll bid`, callback_data: `b:${n}:${t.id}` },
    { text: `${n} ${t.status === 'not_relevant' ? '❌' : '·'} Not relevant`, callback_data: `n:${n}:${t.id}` },
    { text: t.assignee ? `${n} 🙋 ${t.assignee}` : `${n} · Take it`, callback_data: `m:${n}:${t.id}` },
  ];
}

export const keyboard = (numbered) => ({ inline_keyboard: numbered.map(([n, t]) => buttonRow(n, t)) });

/** Tender (number, id) pairs a message's keyboard holds, in order. */
export const keyboardTenders = (markup) =>
  (markup?.inline_keyboard || []).map((row) => row[0]?.callback_data?.split(':')).filter((p) => p?.length === 3).map(([, n, id]) => [Number(n), id]);

/**
 * Messages listing tenders, each with its buttons.
 * group: under one heading per institution (most tenders first), as in the digest;
 * otherwise each line names its institution.
 * @returns {{text: string, reply_markup: object}[]}
 */
export function tenderMessages(rows, head, { group = false } = {}) {
  let list = rows;
  const counts = new Map();
  if (group) {
    for (const r of rows) counts.set(institution(r), (counts.get(institution(r)) || 0) + 1);
    const rank = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
    list = [...rows].sort((a, b) => rank.indexOf(institution(a)) - rank.indexOf(institution(b)));
  }
  const messages = [];
  let cur;
  const start = () => { cur = { text: messages.length ? '' : head, items: [], inst: null }; messages.push(cur); };
  start();
  list.forEach((r, i) => {
    const n = i + 1;
    const inst = institution(r);
    const piece = (fresh) => {
      const title = r.url ? `<a href="${esc(r.url)}">${esc(r.title)}</a>` : esc(r.title);
      const notes = [!group && esc(inst), r.closing && `closes ${fmtDay(r.closing)}`].filter(Boolean).join(' · ');
      return (group && (fresh || inst !== cur.inst) ? `\n\n<b>${esc(inst)}</b>: ${counts.get(inst)} new` : '')
        + `\n${n}. ${title}${notes ? `\n<i>${notes}</i>` : ''}`;
    };
    let text = piece(false);
    if (cur.items.length >= MAX_ITEMS || cur.text.length + text.length > MAX_CHARS) { start(); text = piece(true); }
    cur.text += text.slice(0, MAX_CHARS);
    cur.inst = inst;
    cur.items.push([n, r]);
  });
  return messages.map((m) => ({ text: m.text.trim(), reply_markup: keyboard(m.items) }));
}

/** Send tender lists made by tenderMessages(). */
export async function sendTenders(rows, head, opts = {}, extra = {}) {
  for (const { text, reply_markup } of tenderMessages(rows, head, opts)) await send(text, { reply_markup, ...extra });
}
