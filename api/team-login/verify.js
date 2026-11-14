'use strict';

/* POST /api/team-login/verify   { phone, code }
   Checks the code with Twilio Verify. On success it sets the 30 day
   unlock cookie the middleware accepts and answers { ok, redirect: "/" }.

   Limits (per function instance): 10 tries per IP and 5 per number in
   any 10 minutes. Twilio Verify also stops a code after 5 wrong tries. */

const { methodGuard, readJsonBody } = require('../_airtable');
const tl = require('../_team-login');

const WINDOW = 10 * 60 * 1000;

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');

  const ip = tl.clientIp(req);
  if (!tl.throttle('verify-ip:' + ip, 10, WINDOW)) {
    return res.status(429).json({ error: 'Too many tries. Wait a few minutes and try again.' });
  }

  const body = readJsonBody(req);
  const e164 = tl.toE164(body.phone);
  const code = String(body.code || '').trim();

  if (!e164 || !tl.allowed(e164)) {
    return res.status(403).json({ error: "This number isn't authorized." });
  }
  if (!tl.ready()) {
    return res.status(503).json({ error: "Team login isn't available right now." });
  }
  if (!/^\d{4,10}$/.test(code)) {
    return res.status(400).json({ error: 'Enter the code from the text message.' });
  }
  if (!tl.throttle('verify-phone:' + e164, 5, WINDOW)) {
    return res.status(429).json({ error: 'Too many tries. Wait a few minutes and try again.' });
  }

  let approved = false;
  try {
    approved = await tl.checkCode(e164, code);
  } catch (err) {
    console.error('[team-login]', err && err.message);
    return res.status(502).json({ error: "We couldn't check the code. Try again." });
  }
  if (!approved) {
    console.log(`[team-login] code rejected (${tl.tail(e164)})`);
    return res.status(401).json({ error: 'That code is incorrect or expired.' });
  }

  console.log(`[team-login] signed in (${tl.tail(e164)})`);
  res.setHeader('Set-Cookie', tl.unlockCookies(tl.makeToken(e164, Date.now() / 1000)));
  return res.status(200).json({ ok: true, redirect: '/' });
};
