'use strict';

/* ==================================================================
   Shared Stripe helper.

   The secret key lives here, on the server, read from STRIPE_SECRET_KEY.
   It is never sent to the browser and never appears in any response
   body, including error responses. The publishable key is a different
   thing entirely: it is designed to be public and is handed to the page
   by /api/stripe-config.

   No SDK, same as the Airtable and Twilio helpers. Stripe's REST API is
   form encoded, so requests go out as application/x-www-form-urlencoded.

   Filename starts with an underscore so Vercel treats it as a plain
   module and not as a routable endpoint.
   ================================================================== */

const STRIPE_API = 'https://api.stripe.com/v1';
const TIMEOUT_MS = 15000;

const PLACEHOLDERS = new Set([
  '',
  'YOUR_STRIPE_SECRET_KEY_HERE',
  'sk_test_xxx',
]);

function secretKey() {
  return (process.env.STRIPE_SECRET_KEY || '').trim();
}

function publishableKey() {
  return (process.env.STRIPE_PUBLISHABLE_KEY || '').trim();
}

function isConfigured() {
  return !PLACEHOLDERS.has(secretKey());
}

/* True when the configured key is a test key. Used to label the page so
   nobody mistakes a test run for a real one, and the other way round. */
function isTestMode() {
  return secretKey().startsWith('sk_test_');
}

/* Stripe wants the smallest currency unit. Dollars in, cents out, and
   rounded rather than truncated so 112.5 becomes 11250 and not 11249. */
function toCents(dollars) {
  return Math.round(Number(dollars) * 100);
}

/* Flattens the nested shape Stripe's form encoding expects, so
   { metadata: { a: 1 } } goes out as metadata[a]=1. */
function formEncode(obj, prefix = '', params = new URLSearchParams()) {
  Object.entries(obj).forEach(([k, v]) => {
    if (v === undefined || v === null) return;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) formEncode(v, key, params);
    else params.set(key, String(v));
  });
  return params;
}

/* Low level Stripe call. Returns parsed JSON.
   Throws an Error whose message is safe to log but never includes the
   secret key or the Authorization header. */
async function stripeRequest(path, { method = 'POST', body, idempotencyKey } = {}) {
  if (!isConfigured()) {
    const err = new Error('Stripe secret key is not configured');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers = { Authorization: `Bearer ${secretKey()}` };
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  /* Retrying a create must not charge twice. Stripe returns the original
     object for a repeated key rather than making a second one. */
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let res;
  try {
    res = await fetch(`${STRIPE_API}${path}`, {
      method,
      headers,
      body: body ? formEncode(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(
      e.name === 'AbortError' ? 'Stripe request timed out' : 'Stripe request failed'
    );
    err.code = 'UPSTREAM';
    throw err;
  }
  clearTimeout(timer);

  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }

  if (!res.ok) {
    /* Stripe error bodies describe the request, not the credential, but
       they are still upstream detail. Log server side, hand the caller a
       generic message plus the decline reason where there is one, since
       "your card was declined" is worth showing a customer. */
    const detail = data && data.error ? data.error : {};
    console.error(
      `Stripe ${method} ${path} -> ${res.status}: ${detail.code || ''} ${detail.message || text.slice(0, 200)}`
    );
    const err = new Error(`Stripe responded ${res.status}`);
    err.code = 'UPSTREAM';
    err.status = res.status;
    err.stripeCode = detail.code || null;
    err.declineCode = detail.decline_code || null;
    throw err;
  }

  if (!data) {
    const err = new Error('Stripe returned invalid JSON');
    err.code = 'UPSTREAM';
    throw err;
  }
  return data;
}

module.exports = {
  isConfigured,
  isTestMode,
  publishableKey,
  toCents,
  stripeRequest,
};
