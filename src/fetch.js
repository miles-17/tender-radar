// Polite HTTP fetching via curl: browser-like UA, timeout, one retry, captcha
// detection. Captcha / bot-check pages are reported as BlockedError, never solved.
// curl (not Node fetch) because some bank WAFs challenge Node's TLS client.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { extractItems, extractJsonItems } from './extract.js';

const run = promisify(execFile);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT_S = 45;

export class BlockedError extends Error {}

// Phrases only bot-check pages contain (a bare "captcha" also matches normal forms).
const CHALLENGE_RE = /security check required|what code is in the image|testing whether you are a human|<title>just a moment\.\.\.<\/title>|cf-chl-|incapsula incident/i;

async function curl(url, { method = 'GET', body, headers = {} } = {}) {
  const args = ['-sS', '-L', '--compressed', '-m', String(TIMEOUT_S), '-A', UA,
    '-H', 'accept: text/html,application/json;q=0.9,*/*;q=0.8', '-w', '\n%{http_code}'];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (method !== 'GET') args.push('-X', method);
  if (body) args.push('--data', String(body));
  args.push('--', url);
  const { stdout } = await run('curl', args, { maxBuffer: 64 * 1024 * 1024 });
  const cut = stdout.lastIndexOf('\n');
  return { status: Number(stdout.slice(cut + 1)), text: stdout.slice(0, cut) };
}

async function get(url, init = {}) {
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const { status, text: body } = await curl(url, init);
      if (CHALLENGE_RE.test(body)) throw new BlockedError('site shows a captcha / bot check');
      if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
      return body;
    } catch (err) {
      if (err instanceof BlockedError) throw err;
      lastErr = err;
      await new Promise((r) => setTimeout(r, 5_000));
    }
  }
  throw lastErr;
}

async function rupali(site) {
  const endpoint = new URL('employee-grid-data1.php', site.url).href;
  const body = new URLSearchParams({
    type: '18', news_status: '1', ZoneID: '', year: '', title: '',
    draw: '1', start: '0', length: '5000', 'order[0][column]': '2', 'order[0][dir]': 'desc', // length: whole archive (~1.4k rows, ~300 KB)
  });
  const json = JSON.parse(await get(endpoint, {
    method: 'POST',
    body,
    headers: { 'x-requested-with': 'XMLHttpRequest', referer: site.url, 'content-type': 'application/x-www-form-urlencoded' },
  }));
  // Rows: [serial, "<a href=...>title</a>", division, "YYYY-MM-DD"] -> reuse table extractor.
  const rows = (json.data || []).map((r) => `<tr><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td></tr>`).join('');
  return extractItems(`<table>${rows}</table>`, site.url, { item: 'tr' })
    .map((it) => ({ ...it, title: it.title.replace(/&amp;/g, '&') }));
}

/** Fetch one site and return its candidate tender items. */
export async function scrapeSite(site) {
  if (site.kind === 'rupali') return rupali(site);
  const html = await get(site.url);
  if (site.kind === 'json') return extractJsonItems(html, site.url);
  if (site.kind === 'auto') {
    // User-added site: try both page links and script-embedded JSON, merge.
    const seen = new Set();
    return [...extractItems(html, site.url), ...extractJsonItems(html, site.url)].filter((it) => {
      const key = `${it.title.toLowerCase()}|${it.url || ''}`;
      return !seen.has(key) && seen.add(key);
    });
  }
  return extractItems(html, site.url, { scope: site.scope || undefined });
}
