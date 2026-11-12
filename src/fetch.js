// Polite HTTP fetching via curl: browser-like UA, timeout, one retry, captcha
// detection. Captcha / bot-check pages are reported as BlockedError, never solved.
// curl (not Node fetch) because some bank WAFs challenge Node's TLS client.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { connect, rootCertificates } from 'node:tls';
import { X509Certificate } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractItems, extractJsonItems, extractEgpRows, egpTotalPages, extractBppaRows, bppaMinistries } from './extract.js';

const run = promisify(execFile);
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TIMEOUT_S = 45;

export class BlockedError extends Error {}

// Phrases only bot-check pages contain (a bare "captcha" also matches normal forms).
const CHALLENGE_RE = /security check required|what code is in the image|testing whether you are a human|<title>just a moment\.\.\.<\/title>|cf-chl-|incapsula incident|http-equiv="CacheControl" content="no-cache"\/>\s*<script[^>]*>\s*function SHA1\(/i;

// Some bank servers don't send their intermediate certificate (curl error 60).
// Browsers fetch it from the URL in the site certificate (AIA "CA Issuers");
// do the same. The fetched cert is only a chain candidate: curl still has to
// verify the whole chain up to a trusted root, so nothing is trusted blindly.
const CA_BUNDLE = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'ca-bundle.pem');
const intermediates = new Map(); // AIA URL -> PEM
const needsBundle = new Set(); // hostnames

function issuerUrl(host) {
  return new Promise((resolve, reject) => {
    // Unverified on purpose: we only read the certificate's AIA field here.
    const sock = connect({ host, port: 443, servername: host, rejectUnauthorized: false }, () => {
      const cert = sock.getPeerCertificate();
      sock.end();
      resolve(cert?.infoAccess?.['CA Issuers - URI']?.[0]);
    });
    sock.setTimeout(20_000, () => sock.destroy(new Error('TLS timeout')));
    sock.on('error', reject);
  });
}

async function addIntermediate(url) {
  const host = new URL(url).hostname;
  const aia = await issuerUrl(host).catch(() => null);
  if (!aia || !/^http:\/\//.test(aia)) return false;
  if (!intermediates.has(aia)) {
    const { stdout } = await run('curl', ['-sS', '-L', '-m', '30', '--', aia], { encoding: 'buffer', maxBuffer: 1 << 20 });
    intermediates.set(aia, new X509Certificate(stdout).toString()); // DER or PEM in, PEM out
    mkdirSync(dirname(CA_BUNDLE), { recursive: true });
    writeFileSync(CA_BUNDLE, [...rootCertificates, ...intermediates.values()].join('\n'));
  }
  needsBundle.add(host);
  return true;
}

async function curl(url, opts = {}) {
  const host = new URL(url).hostname;
  try {
    return await curlOnce(url, opts, needsBundle.has(host));
  } catch (err) {
    if (err.code !== 60 || needsBundle.has(host) || !(await addIntermediate(url))) throw err;
    return curlOnce(url, opts, true);
  }
}

async function curlOnce(url, { method = 'GET', body, headers = {} } = {}, bundle = false) {
  const args = ['-sS', '-L', '--compressed', '-m', String(TIMEOUT_S), '-A', UA,
    '-H', 'accept: text/html,application/json;q=0.9,*/*;q=0.8', '-w', '\n%{http_code}'];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (method !== 'GET') args.push('-X', method);
  if (body) args.push('--data', String(body));
  if (bundle) args.push('--cacert', CA_BUNDLE);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const dmy = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;

// e-GP (eprocure.gov.bd): every ministry's live tenders, via the public
// "Advanced Search" list. Fetches what was published since yesterday, 100 a page.
async function egp(site) {
  const since = new Date(Date.now() - 86400_000);
  const items = [];
  for (let page = 1, pages = 1; page <= pages && page <= 30; page++) {
    const body = new URLSearchParams({
      funName: 'AllTenders', viewType: 'Live', departmentId: '', office: '', procNature: '', procType: '',
      procMethod: '', tenderId: '', refNo: '', pubDtFrm: dmy(since), pubDtTo: '', closeDtFrm: '', closeDtTo: '',
      cpvCategory: '', isFrame: '', budgetType: '', pageNo: String(page), size: '100', h: 't',
    });
    const html = await get(new URL('/TenderDetailsServlet', site.url).href, {
      method: 'POST', body, headers: { 'x-requested-with': 'XMLHttpRequest', referer: site.url, 'content-type': 'application/x-www-form-urlencoded' },
    });
    items.push(...extractEgpRows(html));
    pages = egpTotalPages(html);
    await sleep(500);
  }
  return items;
}

// BPPA (bppa.gov.bd) newspaper advertisements. Rows don't name the ministry, so
// read each ministry's filtered list: newest page of goods, works, services and
// physical services. ~200 small requests, spaced out.
const BPPA_TYPES = ['goods', 'works', 'services', 'physical-service'];
async function bppa(site) {
  const listUrl = (type, ministry = '') =>
    `https://www.bppa.gov.bd/advertisement-notices/advertisement-${type}.html?ministryId.id=${ministry}&agencyId.id=&page=0`;
  const ministries = bppaMinistries(await get(listUrl('goods')));
  if (!ministries.length) throw new Error('BPPA ministry list not found');
  const items = [];
  for (const m of ministries) {
    for (const type of BPPA_TYPES) {
      const url = listUrl(type, m.id);
      items.push(...extractBppaRows(await get(url), url, m.name));
      await sleep(300);
    }
  }
  return items;
}

/** Fetch one site and return its candidate tender items. */
export async function scrapeSite(site) {
  if (site.kind === 'rupali') return rupali(site);
  if (site.kind === 'egp') return egp(site);
  if (site.kind === 'bppa') return bppa(site);
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
