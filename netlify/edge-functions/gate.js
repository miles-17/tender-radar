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

const page = (error = '') => `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tender Radar</title>
<style>
  :root { --bg: #f6f7f9; --card: #fff; --text: #1b1f24; --muted: #5b6573; --line: #d8dde3; --accent: #2457c5; --err: #b42318; }
  @media (prefers-color-scheme: dark) { :root { --bg: #111418; --card: #1a1f25; --text: #e6e9ed; --muted: #9aa4b1; --line: #2c333b; --accent: #7aa2ff; --err: #ff8a80; } }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--text); font: 16px/1.5 system-ui, sans-serif; }
  form { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 28px; width: min(340px, calc(100vw - 32px)); box-sizing: border-box; }
  h1 { margin: 0 0 4px; font-size: 20px; } p { margin: 0 0 16px; color: var(--muted); font-size: 14px; }
  label { display: block; font-size: 14px; margin-bottom: 6px; }
  input, button { width: 100%; box-sizing: border-box; font: inherit; padding: 9px 12px; border-radius: 6px; }
  input { border: 1px solid var(--line); background: var(--bg); color: var(--text); }
  button { margin-top: 12px; border: 0; background: var(--accent); color: #fff; cursor: pointer; }
  .err { color: var(--err); margin: 10px 0 0; }
</style></head>
<body><form method="post" action="/login">
  <h1>Tender Radar</h1><p>Enter the team password.</p>
  <label for="pw">Password</label>
  <input id="pw" name="password" type="password" autocomplete="current-password" required autofocus>
  <button type="submit">Sign in</button>
  ${error ? `<p class="err" role="alert">${error}</p>` : ''}
</form></body></html>`;

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

// Function routes under /.netlify/ check their own secret (SCRAPE_KEY).
export const config = { path: '/*', excludedPath: ['/.netlify/*'] };
