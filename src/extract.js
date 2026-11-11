// Generic tender-list extractor. Pulls candidate items (title + link + date)
// out of a bank's tender page, ignoring site chrome (header/nav/footer/menus).
import * as cheerio from 'cheerio';

// Site chrome to drop before scanning. Class/id matching is by whole token
// (e.g. "site-footer"), never substring: themes put "no-footer" or
// "sidebar-page-container" on the wrappers that hold the actual tender table.
const CHROME_TAGS = 'header,nav,footer,script,style,noscript,svg,[role=navigation]';
const CHROME_TOKEN = /^(?:(?:site|main|top|page|mobile|mega)[-_])?(?:header|footer|menu|navbar|nav|navigation|sidebar|breadcrumbs?|social|offcanvas|topbar)(?:[-_](?:wrap|wrapper|area|section|menu|inner|top|bottom|links|widget))?$/i;

function stripChrome($) {
  $(CHROME_TAGS).not('body,html').remove();
  $('form').filter((_, el) => !$(el).find('table').length).remove();
  $('[class],[id]').each((_, el) => {
    const $el = $(el);
    const tokens = `${$el.attr('class') || ''} ${$el.attr('id') || ''}`.split(/\s+/);
    if (tokens.some((t) => CHROME_TOKEN.test(t)) && !$el.find('table').length) $el.remove();
  });
}

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
const DATE_RE = new RegExp(
  String.raw`\b(\d{1,2})(?:st|nd|rd|th)?[\s\-./,]+(${MONTHS})[a-z]*[\s\-./,]+(\d{4})\b` +
  String.raw`|\b(${MONTHS})[a-z]*[\s\-./]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-./]+(\d{4})\b` +
  String.raw`|\b(\d{1,2})[\-./](\d{1,2})[\-./](\d{4})\b` +
  String.raw`|\b(\d{4})[\-./](\d{1,2})[\-./](\d{1,2})\b`,
  'i',
);

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

export function parseDate(text) {
  const m = DATE_RE.exec(text || '');
  if (!m) return null;
  const mon = (s) => MONTHS.split('|').indexOf(s.slice(0, 3).toLowerCase()) + 1;
  let y, mo, d;
  if (m[1]) [d, mo, y] = [+m[1], mon(m[2]), +m[3]];
  else if (m[4]) [mo, d, y] = [mon(m[4]), +m[5], +m[6]];
  else if (m[7]) [d, mo, y] = [+m[7], +m[8], +m[9]]; // BD convention: dd/mm/yyyy
  else[y, mo, d] = [+m[10], +m[11], +m[12]];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Words that make a link look like a tender/procurement notice.
const TENDER_RE = /tender|rfp|rfq|rfi|request for|proposal|quotation|eoi|expression of interest|procure|enlist|bid|invitation|supply|purchase|vendor|software|system|solution|re-?tender|corrigendum|addendum|notice/i;
// Obvious non-tender noise that shows up in content areas.
const NOISE_RE = /^(?:(?:read|view|learn|click|see)\s*(?:more|here|details|now)?|download(?:\s*(?:now|here|file|pdf|link))?|preview\s*\w*|details|more|pdf|here|apply now|home|back|next|previous|(?:go|skip) to \w+(?: \w+)?|\d+)$/i;

/**
 * @param {string} html
 * @param {string} pageUrl
 * @param {{scope?: string, item?: string, keywords?: boolean}} cfg
 *   scope:   CSS selector for the content area (default: whole body minus chrome)
 *   item:    CSS selector for one notice row; title/link/date are read from it
 *   keywords: require TENDER_RE match (default true when no `item` selector)
 */
export function extractItems(html, pageUrl, cfg = {}) {
  const $ = cheerio.load(html);
  stripChrome($);
  const root = cfg.scope ? $(cfg.scope) : $('body');
  const seen = new Map();

  const add = (title, href, context) => {
    title = clean(title);
    if (!title || title.length < 8 || NOISE_RE.test(title)) return;
    let url = null;
    if (href && !/^(javascript:|mailto:|tel:)/i.test(href) && href !== '#') {
      try { url = new URL(href, pageUrl).href; } catch { /* bad href */ }
    }
    const requireKw = cfg.keywords ?? !cfg.item;
    if (requireKw && !TENDER_RE.test(`${title} ${url || ''}`)) return;
    const key = `${title.toLowerCase()}|${url || ''}`;
    if (seen.has(key)) return;
    seen.set(key, {
      title: title.slice(0, 500),
      url,
      published: parseDate(context) || parseDate(title) || parseDate(url || ''),
      context: clean(context).slice(0, 1000),
    });
  };

  if (cfg.item) {
    root.find(cfg.item).each((_, el) => {
      const $el = $(el);
      const a = $el.is('a') ? $el : $el.find('a[href]').first();
      // Prefer the row's heading text; fall back to the longest cell / link text.
      let title = clean($el.find('h1,h2,h3,h4,h5,h6,strong,.title').first().text());
      if (!title) {
        const cells = $el.find('td').map((__, td) => clean($(td).text())).get();
        title = cells.sort((x, y) => y.length - x.length)[0] || clean(a.text()) || clean($el.text());
      }
      add(title, a.attr('href'), $el.text());
    });
  } else {
    root.find('a[href]').each((_, el) => {
      const $a = $(el);
      let title = clean($a.text());
      const $row = $a.closest('tr,li,article,.card,p,div');
      // Bare "Download"/"View" links: take the title from the surrounding row.
      if (!title || NOISE_RE.test(title)) {
        const $tr = $a.closest('tr');
        title = $tr.length
          ? $tr.find('td').map((__, td) => clean($(td).text())).get().sort((x, y) => y.length - x.length)[0]
          : clean($row.text());
      }
      add(title, $a.attr('href'), $row.text());
    });
  }
  return [...seen.values()];
}

// Next.js / SPA pages ship the tender list as JSON inside <script> tags
// (e.g. `self.__next_f.push([1,"..."])`). Pull {title, file-url} pairs out of it.
const TITLE_KEY = String.raw`"(?:title|Title|name|Name|subject|Subject|notice_title|tender_title)"\s*:\s*"((?:[^"\\]|\\.){8,500})"`;
const URL_KEY = String.raw`"(?:file|File|Download|download|url|link|pdf|attachment|document|file_url|file_path)"\s*:\s*"((?:[^"\\]|\\.){4,800})"`;
const PAIR_RE = new RegExp(`${TITLE_KEY}[^{}]{0,600}?${URL_KEY}|${URL_KEY}[^{}]{0,600}?${TITLE_KEY}`, 'g');

const jsonStr = (s) => { try { return JSON.parse(`"${s}"`); } catch { return s; } };

function scriptPayloads(html) {
  const parts = [html];
  for (const m of html.matchAll(/self\.__next_f\.push\(\[1,"((?:[^"\\]|\\.)*)"\]\)/g)) parts.push(jsonStr(m[1]));
  for (const m of html.matchAll(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/g)) parts.push(m[1]);
  return parts;
}

export function extractJsonItems(html, pageUrl) {
  const seen = new Map();
  for (const text of scriptPayloads(html)) {
    for (const m of text.matchAll(PAIR_RE)) {
      const title = clean(jsonStr(m[1] ?? m[4]));
      const raw = jsonStr(m[2] ?? m[3]);
      if (!TENDER_RE.test(title) || !/[./]/.test(raw)) continue;
      let url;
      try { url = new URL(raw, pageUrl).href; } catch { continue; }
      const key = `${title.toLowerCase()}|${url}`;
      if (!seen.has(key)) {
        seen.set(key, { title: title.slice(0, 500), url, published: parseDate(title) || parseDate(url), context: title });
      }
    }
  }
  return [...seen.values()];
}
