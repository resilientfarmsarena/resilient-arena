/* Coming Soon gate (Vercel Routing Middleware, Edge runtime).

   Every visitor sees the Coming Soon page (holding.html) at whatever
   address they open. The address stays as typed: it is a rewrite, not
   a redirect. The real site stays deployed underneath for anyone who
   holds the preview cookie.

   Unlock:  any page with ?preview=<SITE_PREVIEW_KEY>  sets the cookie
            and drops the key from the address.
   Lock:    any page with ?preview=off                 clears it.

   Other ?preview= values are left alone, because /hiring/<job>?preview=
   <record ID> is how a draft job is looked over before it is posted.

   Fails closed: with SITE_PREVIEW_KEY unset, nobody can unlock.

   Always passes through: /api/* (crons, Stripe webhook, the forms), the
   files under /assets/, the icons, the web manifest, robots.txt and the
   holding page itself. /api/hiring is the one API path that writes
   whole pages, so it is gated like a page.

   To open a page to the public while the rest stays gated, add its
   path to PUBLIC_PAGES. To take the whole gate down, delete this file. */

import { next, rewrite } from '@vercel/functions';

export const config = {
  matcher: ['/((?!assets/|favicon\\.ico|site\\.webmanifest|robots\\.txt).*)'],
};

const HOLDING = '/holding.html';
const COOKIE = 'ra_preview';
const UI_COOKIE = 'ra_preview_ui';
const MAX_AGE = 60 * 60 * 24 * 30;
const TOKEN_LABEL = 'resilient-arena-site-preview-v1';

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

async function tokenFor(secret) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return b64url(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(TOKEN_LABEL)));
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
  const secret = (process.env.SITE_PREVIEW_KEY || '').trim();
  const asked = url.searchParams.get('preview');

  if (asked === 'off') {
    return bounce(url, [
      `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
      `${UI_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Lax`,
    ]);
  }

  if (secret && asked && same(asked, secret)) {
    const token = await tokenFor(secret);
    return bounce(url, [
      `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
      `${UI_COOKIE}=1; Path=/; Max-Age=${MAX_AGE}; Secure; SameSite=Lax`,
    ]);
  }

  if (isOpen(url.pathname)) return next();

  if (secret) {
    const held = readCookie(request, COOKIE);
    if (held && same(held, await tokenFor(secret))) return next();
  }

  return rewrite(new URL(HOLDING, request.url));
}
