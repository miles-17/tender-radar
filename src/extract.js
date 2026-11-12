// Generic tender-list extractor. Pulls candidate items (title + link + date)
// out of a bank's tender page, ignoring site chrome (header/nav/footer/menus).
import * as cheerio from 'cheerio';

// Site chrome to drop before scanning. Class/id matching is by whole token
// (e.g. "site-footer"), never substring: themes put "no-footer" or
// "sidebar-page-container" on the wrappers that hold the actual tender table.
const CHROME_TAGS = 'header,nav,footer,script,style,noscript,svg,[role=navigation]';
const CHROME_TOKEN = /^(?:(?:site|main|top|page|mobile|mega)[-_])?(?:header|footer|menu|navbar|nav|navigation|sidebar|breadcrumbs?|social|offcanvas|topbar)(?:[-_](?:wrap|wrapper|area|section|menu|inner|top|bottom|links|widget))?$/i;

function stripChrome($) {
  // Broken markup (an unclosed <header>) can swallow the whole page body;
  // an element holding most of the page's links is content, not chrome.
  // Decided before any removal: removing a nested menu first would shrink the count.
  const links = $('body a[href]').length;
  // Must also wrap real content blocks: on sparse pages a plain menu can hold half the links.
  const pageHolders = new Set(links > 20 ? $(`${CHROME_TAGS},form`).filter((_, el) =>
    $(el).find('a[href]').length > links / 2 && $(el).find('main,section,article,table').length > 0).get() : []);
  const isPage = ($el) => pageHolders.has($el.get(0));
  $(CHROME_TAGS).not('body,html').filter((_, el) => !isPage($(el))).remove();
  $('form').filter((_, el) => !$(el).find('table').length && !isPage($(el))).remove();
  // Containers only: some sites put class="menu" on the tender links themselves.
  $('[class],[id]').not('a').each((_, el) => {
    const $el = $(el);
    const tokens = `${$el.attr('class') || ''} ${$el.attr('id') || ''}`.split(/\s+/);
    if (tokens.some((t) => CHROME_TOKEN.test(t)) && !$el.find('table').length && !isPage($el)) $el.remove();
  });
}

const MONTHS = 'jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec';
// Digit lookarounds, not \b: pages glue labels to dates ("STARTS12-Nov-2026ENDS").
const DATE_RE = new RegExp(
  String.raw`(?<!\d)(\d{1,2})(?:st|nd|rd|th)?[\s\-./,]+(${MONTHS})[a-z]*[\s\-./,]+(\d{4})(?!\d)` +
  String.raw`|\b(${MONTHS})[a-z]*[\s\-./]+(\d{1,2})(?:st|nd|rd|th)?,?[\s\-./]+(\d{4})(?!\d)` +
  String.raw`|(?<!\d)(\d{1,2})[\-./](\d{1,2})[\-./](\d{4})(?!\d)` +
  String.raw`|(?<!\d)(\d{4})[\-./](\d{1,2})[\-./](\d{1,2})(?!\d)`,
  'i',
);

const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();

export function parseDate(text) {
  const m = DATE_RE.exec(text || '');
  if (!m) return null;
  // Index in a 12-entry list: MONTHS also has 'sept', which would shift oct-dec by one.
  const mon = (s) => 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(s.slice(0, 3).toLowerCase()) / 3 + 1;
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
const DOC_RE = /\.(?:pdf|docx?|xlsx?|zip|rar)(?:[?#]|$)/i;
// Obvious non-tender noise that shows up in content areas.
const NOISE_RE = /^(?:(?:read|view|learn|click|see)\s*(?:more|here|details|now)?|download(?:\s*(?:now|here|file|pdf|link))?|preview\s*\w*|details|more|open|pdf(?: file)?|here|apply now|for better view|tender notice|home|back|next|previous|(?:go|skip) to \w+(?: \w+)?|\d+)$/i;
// Ignore wrapping symbols: "[+]Details", "» Download".
const isNoise = (t) => NOISE_RE.test(t.replace(/^\W+|\W+$/g, ''));

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

  // listRow: a dated table row linking to a document. On a tender page that is
  // a notice even when its title has no tender word (e.g. "Digital Banking Revamp").
  const add = (title, href, context, listRow = false) => {
    title = clean(title).replace(/^click (?:here )?to download (?:the )?/i, '');
    if (!title || title.length < 8 || isNoise(title)) return;
    let url = null;
    if (href && !/^(javascript:|mailto:|tel:)/i.test(href) && href !== '#') {
      try { url = new URL(href, pageUrl).href; } catch { /* bad href */ }
    }
    // Title is only "Tender Notice" (+ start/end dates): the real subject is in an
    // image, but the document's filename often names it ("Steel_Furniture.pdf").
    const bare = title.replace(/\b(?:starts?|ends?|closing|deadline)(?![a-z])|for better view/gi, ' ').replace(DATE_RE, ' ').replace(DATE_RE, ' ');
    if (url && /^\W*(?:tender\s*notice|notice|tender)\W*$/i.test(bare)) {
      const name = decodeURIComponent(url.split(/[?#]/)[0].split('/').pop() || '').replace(DOC_RE, '').replace(/[_+.-]+/g, ' ').trim().replace(/^tende?r?\s*notice\s+(?=.*[a-z]{3})/i, '');
      if (/[a-z]{3}/i.test(name) && !/^\W*(?:tende?r?\s*notice|notice|tender)\W*[\d\s]*$/i.test(name)) title = `${clean(bare)}: ${name}`;
    }
    const requireKw = cfg.keywords ?? !cfg.item;
    if (requireKw && !listRow && !TENDER_RE.test(`${title} ${url || ''}`)) return;
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
      let $row = $a.closest('tr,li,article,.card,p,div');
      // A row holding nothing but the link ("For Better View"): climb to the
      // enclosing block, which carries the notice's title and dates.
      // Document links only, into a small block: menu links would climb into whole menus.
      for (let up = 0; up < 3 && /\.(?:pdf|docx?|xlsx?|zip|rar|jpe?g|png)(?:[?#]|$)/i.test($a.attr('href')) && $row.length && !$row.is('tr') && clean($row.text()) === clean($a.text()); up++) {
        const $up = $row.parent().closest('li,article,.card,div');
        if (!$up.length || clean($up.text()).length > 300) break;
        $row = $up;
      }
      // Bare "Download"/"View" links: take the title from the surrounding row.
      if (!title || isNoise(title)) {
        const $tr = $a.closest('tr');
        title = $tr.length
          ? $tr.find('td').map((__, td) => clean($(td).text())).get().sort((x, y) => y.length - x.length)[0]
          : clean($row.text());
      }
      const $tr = $a.closest('tr');
      const listRow = $tr.length > 0 && DOC_RE.test($a.attr('href')) && !!parseDate($tr.text());
      add(title, $a.attr('href'), $row.text(), listRow);
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
