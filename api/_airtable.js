'use strict';

/* ==================================================================
   Shared Airtable helper.

   The personal access token lives here, on the server, read from the
   AIRTABLE_TOKEN environment variable. It is never sent to the browser
   and never appears in any response body, including error responses.

   Filename starts with an underscore so Vercel treats it as a plain
   module and not as a routable endpoint.
   ================================================================== */

const AIRTABLE_API = 'https://api.airtable.com/v0';
const TIMEOUT_MS = 10000;

const PLACEHOLDERS = new Set([
  '',
  'YOUR_PERSONAL_ACCESS_TOKEN_HERE',
  'YOUR_AIRTABLE_TOKEN_HERE',
]);

/* Base IDs. Overridable by env so staging can point somewhere else. */
const BOARDING_BASE = process.env.AIRTABLE_BOARDING_BASE || 'appww5dZtWrtQJiqu';
const HIRING_BASE   = process.env.AIRTABLE_HIRING_BASE   || 'appEh5qi4D2stYTFe';

function token() {
  return (process.env.AIRTABLE_TOKEN || '').trim();
}

/* False when no real token is set. Callers use this to fall back to the
   page's sample data rather than showing an error, which keeps the
   prototype behaviour: sample pens until a genuine token exists. */
function isConfigured() {
  return !PLACEHOLDERS.has(token());
}

/* Low level Airtable call. Returns parsed JSON.
   Throws an Error whose message is safe to log but never includes
   the token or the Authorization header. */
async function airtableRequest(baseId, table, { method = 'GET', query, body } = {}) {
  if (!isConfigured()) {
    const err = new Error('Airtable token is not configured');
    err.code = 'NOT_CONFIGURED';
    throw err;
  }

  let url = `${AIRTABLE_API}/${baseId}/${encodeURIComponent(table)}`;
  if (query && query.toString()) url += `?${query.toString()}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token()}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    const err = new Error(
      e.name === 'AbortError' ? 'Airtable request timed out' : 'Airtable request failed'
    );
    err.code = 'UPSTREAM';
    throw err;
  }
  clearTimeout(timer);

  const text = await res.text();
  if (!res.ok) {
    /* Airtable error bodies describe the request, not the credential,
       but they are still upstream detail. Log server side, return a
       generic message to the caller. */
    console.error(`Airtable ${method} ${baseId}/${table} -> ${res.status}: ${text.slice(0, 500)}`);
    const err = new Error(`Airtable responded ${res.status}`);
    err.code = 'UPSTREAM';
    err.status = res.status;
    throw err;
  }

  try {
    return JSON.parse(text);
  } catch {
    const err = new Error('Airtable returned invalid JSON');
    err.code = 'UPSTREAM';
    throw err;
  }
}

/* Uniform error response. Never leaks upstream detail to the browser. */
function sendError(res, err) {
  if (err && err.code === 'NOT_CONFIGURED') {
    return res.status(200).json({ configured: false });
  }
  console.error(err);
  return res.status(502).json({ error: 'Upstream request failed' });
}

/* Reject anything that is not the expected verb. */
function methodGuard(req, res, allowed) {
  if (req.method === allowed) return true;
  res.setHeader('Allow', allowed);
  res.status(405).json({ error: 'Method not allowed' });
  return false;
}

/* Vercel parses JSON bodies automatically, but be defensive: a raw
   string body shows up when the content type is not application/json. */
function readJsonBody(req) {
  const b = req.body;
  if (!b) return {};
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch { return {}; }
  }
  return typeof b === 'object' ? b : {};
}

/* Trim and cap a free text value before it reaches Airtable. */
function str(v, max = 1000) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

module.exports = {
  BOARDING_BASE,
  HIRING_BASE,
  isConfigured,
  airtableRequest,
  sendError,
  methodGuard,
  readJsonBody,
  str,
};
