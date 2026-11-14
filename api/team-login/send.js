'use strict';

/* POST /api/team-login/send   { phone }
   Texts a Twilio Verify code, but only to a number on SITE_TEAM_PHONES.
   Any other number gets "This number isn't authorized." and no text.

   Limits (per function instance): 5 requests per IP and 3 codes per
   number in any 10 minutes. */

const { methodGuard, readJsonBody } = require('../_airtable');
const tl = require('../_team-login');

const WINDOW = 10 * 60 * 1000;
const NOT_AUTHORIZED = "This number isn't authorized.";

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;
  res.setHeader('Cache-Control', 'no-store');

  const ip = tl.clientIp(req);
  if (!tl.throttle('send-ip:' + ip, 5, WINDOW)) {
    return res.status(429).json({ error: 'Too many tries. Wait a few minutes and try again.' });
  }

  const e164 = tl.toE164(readJsonBody(req).phone);
  if (!e164) return res.status(400).json({ error: 'Enter a 10 digit phone number.' });

  if (!tl.allowed(e164)) {
    console.log(`[team-login] send refused, not on the list (${tl.tail(e164)})`);
    return res.status(403).json({ error: NOT_AUTHORIZED });
  }
  if (!tl.ready()) {
    console.error('[team-login] not configured, no code sent');
    return res.status(503).json({ error: "Team login isn't available right now." });
  }
  if (!tl.throttle('send-phone:' + e164, 3, WINDOW)) {
    return res.status(429).json({ error: 'Too many codes. Wait a few minutes and try again.' });
  }

  try {
    await tl.sendCode(e164);
    console.log(`[team-login] code sent (${tl.tail(e164)})`);
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[team-login]', err && err.message);
    return res.status(502).json({ error: "We couldn't send the code. Try again." });
  }
};
