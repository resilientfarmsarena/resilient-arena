'use strict';

/* Shared by /api/team-login/send and /api/team-login/verify.

   Team login replaces the old secret unlock link on the Coming Soon gate.
   Only numbers listed in SITE_TEAM_PHONES (comma-separated E.164) can get
   a code, and a number not on that list never reaches Twilio.

   The unlock cookie is  v1.<digits>.<expiry seconds>.<signature>  where
   the signature is an HMAC-SHA256 of "v1|<+E.164>|<expiry>" keyed with
   SITE_PREVIEW_KEY. middleware.js checks the same signature, the expiry,
   and that the number is still on the list, so taking a number off the
   list signs that person out.

   Everything fails closed: without SITE_PREVIEW_KEY, SITE_TEAM_PHONES or
   the three Twilio values, no code is sent and no cookie is issued. */

const crypto = require('crypto');

const COOKIE = 'ra_preview';
const UI_COOKIE = 'ra_preview_ui';
const MAX_AGE = 60 * 60 * 24 * 30;

function toE164(input) {
  const raw = String(input || '').trim();
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 15) return null;
  if (raw.startsWith('+')) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return null;
}

function teamPhones() {
  return String(process.env.SITE_TEAM_PHONES || '')
    .split(',')
    .map((p) => p.trim())
    .filter((p) => /^\+\d{10,15}$/.test(p));
}

function allowed(e164) {
  return !!e164 && teamPhones().includes(e164);
}

function signingKey() {
  return String(process.env.SITE_PREVIEW_KEY || '').trim();
}

function twilio() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const service = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid || !token || !service) return null;
  return { service, auth: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64') };
}

/* What the login needs before it will do anything. */
function ready() {
  return !!(signingKey() && teamPhones().length && twilio());
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeToken(e164, nowSeconds) {
  const exp = Math.floor(nowSeconds) + MAX_AGE;
  const sig = b64url(crypto.createHmac('sha256', signingKey()).update(`v1|${e164}|${exp}`).digest());
  return `v1.${e164.slice(1)}.${exp}.${sig}`;
}

function unlockCookies(token) {
  return [
    `${COOKIE}=${token}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`,
    `${UI_COOKIE}=1; Path=/; Max-Age=${MAX_AGE}; Secure; SameSite=Lax`,
  ];
}

/* Twilio Verify over REST, the same calls arena-app makes. */
async function sendCode(e164) {
  const t = twilio();
  const res = await fetch(`https://verify.twilio.com/v2/Services/${t.service}/Verifications`, {
    method: 'POST',
    headers: { Authorization: t.auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: e164, Channel: 'sms' }),
  });
  if (!res.ok) throw new Error(`Verify send failed (${res.status})`);
}

async function checkCode(e164, code) {
  const t = twilio();
  const res = await fetch(`https://verify.twilio.com/v2/Services/${t.service}/VerificationCheck`, {
    method: 'POST',
    headers: { Authorization: t.auth, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: e164, Code: code }),
  });
  if (!res.ok) return false;
  const data = await res.json().catch(() => ({}));
  return data.status === 'approved';
}

/* In-memory throttle. It lives in one function instance, so it is a
   speed bump rather than a wall; Twilio Verify adds its own per-number
   limits behind it, and only listed numbers ever reach Twilio. */
const hits = new Map();
function throttle(key, limit, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= limit) { hits.set(key, list); return false; }
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

function clientIp(req) {
  const fwd = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return fwd || String(req.headers['x-real-ip'] || '') || 'unknown';
}

/* For logs: never the whole number. */
function tail(e164) {
  return e164 ? '...' + e164.slice(-2) : 'none';
}

module.exports = {
  toE164, allowed, ready, makeToken, unlockCookies, sendCode, checkCode,
  throttle, clientIp, tail,
};
