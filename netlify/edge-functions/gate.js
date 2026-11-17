// Shared-password gate in front of the whole site. The password is the
// SITE_PASSWORD environment variable; a correct login sets a signed cookie for
// 30 days. Changing the password signs everyone out.
const COOKIE = 'tr_auth';
const MAX_AGE = 30 * 86400; // seconds

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hmac(secret, message) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

// Compare as HMACs under a fresh key: equal-length strings, and the time taken
// says nothing about how much of a guess was right.
async function same(a, b) {
  const k = crypto.randomUUID();
  return (await hmac(k, a)) === (await hmac(k, b));
}

const sign = async (password, expires) => `${expires}.${await hmac(password, `tender-radar:${expires}`)}`;

async function validCookie(request, password) {
  const value = request.headers.get('cookie')?.match(/(?:^|;\s*)tr_auth=([^;]+)/)?.[1];
  if (!value) return false;
  const expires = Number(value.split('.')[0]);
  return expires > Date.now() / 1000 && (await same(value, await sign(password, expires)));
}

// The sign-in page: the dashboard's chalkboard, with the form inside one big
// chalk circle like the reference board. Styles come from the dashboard's own
// tokens.css and base.css (let through the gate, see config below).
const page = (error = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Sign in to Tender Radar</title>
<meta name="description" content="Bank and government tenders for software work, from Bangladeshi bank tender pages, e-GP and BPPA.">
<script>try { const t = localStorage.getItem('tr-theme'); if (t) document.documentElement.dataset.theme = t; } catch {}</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Gochi+Hand&family=Shantell+Sans:wght,BNCE,INFM@300..800,-100..100,0..100&display=swap">
<style>
/* Hallmark · shape: app screen · genre: playful · theme: custom (the dashboard's system, tokens.css) · screen: sign-in
 * paper: oklch(27% 0.006 70) chalkboard, oklch(97.5% 0.006 85) whiteboard · accent: oklch(82% 0.11 65) peach chalk · display: Shantell Sans · body: Shantell Sans · outlier: Gochi Hand (wordmark)
 * nav: none · signature: the form inside one big chalk circle, as on the reference board · states: default, hover, focus, active, disabled, loading, error
 * axes: mid/handwritten/warm · posture: full palette · modes: light+dark · contrast: pass · v2.0.0 */
/* Hallmark · pre-emit critique: P4 H5 E4 S4 R5 V3 · weakest: V, it repeats the dashboard's system on purpose so signing in feels like the same board */
/* Hallmark · waive 47c · the chalk ring is drawn on the sign-in frame only, never a drawn object · it echoes the user's reference board, whose topics sit in chalk circles */
/* Hallmark · finish-review: subagent · 5 findings · 5 resolved · gap: none */
@import url("/tokens.css");
@import url("/base.css");

body { min-height: 100dvh; display: grid; place-items: center; padding: var(--space-lg) var(--gutter); font-variation-settings: var(--hand-body); }
.board { position: relative; isolation: isolate; width: min(34rem, 100%); aspect-ratio: 1; display: grid; place-content: center; justify-items: center; gap: var(--space-md); padding: var(--space-3xl) var(--space-2xl); text-align: center; }
.board::before { content: ""; position: absolute; inset: 0; z-index: -1; pointer-events: none; border: 3.5px solid var(--color-ink-2); border-radius: 50%; filter: url(#chalk); }
.board::after { content: ""; position: absolute; inset: 10px 6px 4px 12px; z-index: -1; pointer-events: none; border: 1.5px solid var(--color-rule); border-radius: 50%; filter: url(#chalk); transform: rotate(-4deg); }

h1 { position: relative; isolation: isolate; padding: var(--space-2xs) var(--space-md); font: 400 var(--text-wordmark)/1.05 var(--font-outlier); color: var(--color-accent); white-space: nowrap; }
h1::before, h1::after { content: ""; position: absolute; z-index: -1; pointer-events: none; filter: url(#chalk); }
h1::before { inset: 0; border: var(--chalk-line) solid var(--color-ink-2); border-radius: var(--radius-sketch); }
h1::after { inset: -5px -7px; border: 1px solid var(--color-muted); border-radius: var(--radius-sketch-2); }
.lede { margin: 0 0 var(--space-xs); max-width: 28ch; color: var(--color-ink-2); font-size: var(--text-lg); font-variation-settings: var(--hand-loose); text-wrap: balance; }

form { display: grid; gap: var(--space-xs); width: min(18rem, 100%); text-align: left; }
label { font-size: var(--text-sm); color: var(--color-muted); }
input, button { min-height: 44px; font: inherit; font-variation-settings: var(--hand-body); border: var(--chalk-line) solid; border-radius: var(--radius-field); }
input { width: 100%; padding: 0 var(--space-sm); background: transparent; color: var(--color-ink); border-color: var(--color-muted); outline: 2px solid transparent; outline-offset: 2px; transition: border-color var(--dur-short) var(--ease-out); }
input:hover { border-color: var(--color-ink-2); }
input:focus-visible { outline-color: var(--color-ink); transition: none; }
input[aria-invalid="true"], input[aria-invalid="true"]:focus-visible { border-color: var(--color-error); outline-color: var(--color-error); }
button { padding: 0 var(--space-lg); background: var(--color-ink); color: var(--color-paper); border-color: var(--color-ink); font-weight: 700; cursor: pointer; white-space: nowrap; transition: background-color var(--dur-short) var(--ease-out), color var(--dur-micro) var(--ease-out), transform var(--dur-micro) var(--ease-out); }
button:hover { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-accent-ink); }
button:active { transform: translateY(1px); }
button:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; transition: none; }
button:disabled:not([aria-busy="true"]) { cursor: not-allowed; opacity: 0.55; background: transparent; color: var(--color-muted); border-color: var(--color-muted); border-style: dashed; transform: none; }
button[aria-busy="true"] { cursor: progress; }
.err { min-height: 1lh; margin: 0; font-size: var(--text-sm); color: var(--color-error); }

@media (max-width: 30rem) {
  .board { aspect-ratio: auto; padding: var(--space-3xl) var(--space-lg); }
  .board::before { border-radius: 50% / 42%; }
  .board::after { border-radius: 50% / 42%; transform: rotate(-2deg); }
}
@media (prefers-reduced-motion: reduce) { input, button { transition: none; } }
</style></head>
<body>
<svg class="chalk-defs" aria-hidden="true" focusable="false" width="0" height="0" style="position:absolute">
  <filter id="chalk" x="-10%" y="-60%" width="120%" height="220%" color-interpolation-filters="sRGB">
    <feTurbulence type="fractalNoise" baseFrequency="0.03" numOctaves="2" seed="4" result="wobble"/>
    <feDisplacementMap in="SourceGraphic" in2="wobble" scale="3.5" xChannelSelector="R" yChannelSelector="G" result="rough"/>
    <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="1" seed="9" result="grit"/>
    <feColorMatrix in="grit" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  -1.7 0 0 0 1.55" result="dust"/>
    <feComposite in="rough" in2="dust" operator="in"/>
  </filter>
</svg>
<main class="board">
  <h1>Tender Radar</h1>
  <p class="lede">Bank and government tenders for software work.</p>
  <form method="post" action="/login">
    <label for="pw">Team password</label>
    <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus${error ? ' aria-invalid="true" aria-describedby="pw-err"' : ''}>
    <p class="err" id="pw-err" role="alert">${error}</p>
    <button type="submit">Sign in</button>
  </form>
</main>
<script>
  // Loading state: one press only, and the label says what is happening.
  const b = document.querySelector('form button');
  document.querySelector('form').addEventListener('submit', () => {
    b.disabled = true;
    b.setAttribute('aria-busy', 'true');
    b.textContent = 'Signing in…';
  });
  // Coming back to this page (browser back) shows the form ready again.
  addEventListener('pageshow', () => {
    b.disabled = false;
    b.removeAttribute('aria-busy');
    b.textContent = 'Sign in';
  });
</script>
</body></html>`;

const html = (body, status) => new Response(body, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });

export default async (request, context) => {
  const password = Netlify.env.get('SITE_PASSWORD');
  if (!password) return new Response('SITE_PASSWORD is not set', { status: 500 }); // fail closed
  const url = new URL(request.url);

  if (url.pathname === '/login' && request.method === 'POST') {
    const guess = String((await request.formData()).get('password') || '');
    if (!(await same(guess, password))) {
      await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
      return html(page('Wrong password.'), 401);
    }
    const expires = Math.floor(Date.now() / 1000) + MAX_AGE;
    return new Response(null, {
      status: 303,
      headers: {
        location: '/',
        'set-cookie': `${COOKIE}=${await sign(password, expires)}; Max-Age=${MAX_AGE}; Path=/; HttpOnly; Secure; SameSite=Lax`,
      },
    });
  }

  if (await validCookie(request, password)) return context.next();
  if (url.pathname.startsWith('/api/')) return Response.json({ error: 'sign in required' }, { status: 401 });
  return html(page(), 401);
};

// Function routes under /.netlify/ check their own secret (SCRAPE_KEY). The two
// stylesheets hold only colours and spacing, and the sign-in page needs them.
export const config = { path: '/*', excludedPath: ['/.netlify/*', '/tokens.css', '/base.css'] };
