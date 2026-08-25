'use strict';

/* GET /api/stripe-config
   Hands the page its publishable key.

   Publishable keys are meant to be public, so this is not a secret being
   leaked. It comes from an endpoint rather than being pasted into the
   HTML for two reasons: the repository is public, so a key in the markup
   invites somebody to "helpfully" swap in a secret key one day, and this
   way the test and live keys follow the Vercel environment instead of
   needing a commit to change.

   Also reports whether the key is a test key, so the page can say so
   plainly rather than letting a test run look like a real booking. */

const { publishableKey, isConfigured, isTestMode } = require('./_stripe');
const { methodGuard } = require('./_airtable');

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;

  const key = publishableKey();

  /* Both halves have to be present. A publishable key with no secret key
     behind it would let the page mount a card field that can never take
     a payment. */
  if (!key || !isConfigured()) {
    return res.status(200).json({ configured: false });
  }

  res.setHeader('Cache-Control', 'public, max-age=300');
  return res.status(200).json({
    configured: true,
    publishableKey: key,
    testMode: isTestMode(),
  });
};
