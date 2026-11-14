/* Coming Soon gate (Vercel Routing Middleware, Edge runtime).

   Every visitor sees the Coming Soon page (holding.html) at whatever
   address they open. The address stays as typed: it is a rewrite, not
   a redirect. The real site stays deployed underneath for the team.

   Sign in:  /team-login (phone + texted code, numbers on SITE_TEAM_PHONES
             only). /api/team-login/verify sets the cookie checked here:
             v1.<digits>.<expiry>.<HMAC-SHA256 of "v1|+<digits>|<expiry>"
             keyed with SITE_PREVIEW_KEY>. It must be signed, unexpired,
             and for a number still on the list.
   Sign out: any page with ?preview=off.

   Other ?preview= values are left alone, because /hiring/<job>?preview=
   <record ID> is how a draft job is looked over before it is posted.

   Fails closed: with SITE_PREVIEW_KEY or SITE_TEAM_PHONES unset, nobody
   gets past the gate.

   Always passes through: /api/* (crons, Stripe webhook, the forms, team
   login), the files under /assets/, the icons, the web manifest,
   robots.txt, /team-login and the holding page itself. /api/hiring is
   the one API path that writes whole pages, so it is gated like a page.

   To open a page to the public while the rest stays gated, add its
   path to PUBLIC_PAGES. To take the whole gate down, delete this file. */

import { next, rewrite } from '@vercel/functions';

export const config = {
  matcher: ['/((?!assets/|favicon\\.ico|site\\.webmanifest|robots\\.txt).*)'],
};

const HOLDING = '/holding.html';
const COOKIE = 'ra_preview';
const UI_COOKIE = 'ra_preview_ui';

/* Exact paths, without a trailing slash. Empty means everything is gated. */
const PUBLIC_PAGES = [];

const ALWAYS_OPEN = [
  /^\/api\/(?!hiring(\/|$))/,
  /^\/assets\//,
  /^\/favicon\.ico$/,
  /^\/site\.webmanifest$/,
  /^\/robots\.txt$/,
  /^\/\.well-known\//,
  /^\/holding\.html$/,
  /^\/team-login\/?$/,
  /^\/team-login\/index\.html$/,
];

function isOpen(pathname) {
  if (ALWAYS_OPEN.some((re) => re.test(pathname))) return true;
  const bare = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return PUBLIC_PAGES.includes(bare);
}

function b64url(buf) {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function e164List(raw) {
  return String(raw || '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => /^\+\d{10,15}$/.test(p));
}

async function sign(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

/* True only for a cookie this site signed, not yet expired, for a number
   still on SITE_TEAM_PHONES. */
async function validTeamCookie(value, secret, phones) {
  const m = /^v1\.(\d{10,15})\.(\d{9,11})\.([A-Za-z0-9_-]{43})$/.exec(value || '');
  if (!m) return false;
  const phone = '+' + m[1];
  const exp = Number(m[2]);
  if (!(exp > Date.now() / 1000)) return false;
  if (!phones.includes(phone)) return false;
  return same(m[3], await sign(secret, `v1|${phone}|${exp}`));
}

function same(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(request, name) {
  const header = request.headers.get('cookie') || '';
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return '';
}

function bounce(url, cookies) {
  url.searchParams.delete('preview');
  const headers = new Headers({
    Location: url.pathname + url.search + url.hash,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

export default async function middleware(request) {
  const url = new URL(request.url);

  if (url.searchParams.get('preview') === 'off') {
    return bounce(url, [
      `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      `${UI_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`,
    ]);
  }

  if (isOpen(url.pathname)) return next();

  const secret = (process.env.SITE_PREVIEW_KEY || '').trim();
  const phones = e164List(process.env.SITE_TEAM_PHONES);
  if (secret && phones.length) {
    if (await validTeamCookie(readCookie(request, COOKIE), secret, phones)) return next();
  }

  return rewrite(new URL(HOLDING, request.url));
}
