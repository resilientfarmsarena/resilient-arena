'use strict';

/* POST /api/stripe-webhook
   Stripe tells us a deposit cleared; this is the only thing allowed to
   say a reservation is paid.

   WHY NOT TRUST THE PAGE. The browser could be closed the moment after
   the card is confirmed, or somebody could post a made up success to our
   own API. So the page never reports payment. Stripe does, here, and
   this handler checks it two ways before believing it:

     1. The signature on the request must verify against the endpoint's
        signing secret, so the request really came from Stripe.
     2. The PaymentIntent named in the event is then re fetched from the
        Stripe API with our secret key, and its status read from that
        response rather than from the request body. Even a request that
        somehow passed step one cannot lie about the amount or state.

   RAW BODY. Signature verification hashes the exact bytes Stripe sent,
   so body parsing has to be off and the stream read by hand. Re
   serialising a parsed object would change key order or spacing and the
   signature would never match. */

const crypto = require('crypto');
const {
  BOARDING_BASE, airtableRequest, isConfigured: airtableReady, str,
} = require('./_airtable');
const { stripeRequest, isConfigured: stripeReady } = require('./_stripe');

const TABLE = process.env.AIRTABLE_RESERVATIONS_TABLE || 'Arena Reservations';

/* Stripe rejects an event older than this to blunt replay attempts. */
const TOLERANCE_SECONDS = 300;

function rawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/* Verifies a Stripe-Signature header of the form
   t=1234567890,v1=hexdigest[,v1=another]
   The signed payload is the timestamp, a dot, then the raw body. */
function verifySignature(payload, header, secret) {
  if (!header || !secret) return false;

  const parts = String(header).split(',').reduce((acc, kv) => {
    const i = kv.indexOf('=');
    if (i > 0) {
      const k = kv.slice(0, i).trim();
      (acc[k] = acc[k] || []).push(kv.slice(i + 1).trim());
    }
    return acc;
  }, {});

  const timestamp = parts.t && parts.t[0];
  const signatures = parts.v1 || [];
  if (!timestamp || signatures.length === 0) return false;

  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload.toString('utf8')}`)
    .digest('hex');
  const expectedBuf = Buffer.from(expected, 'utf8');

  /* Constant time compare, and only against candidates of equal length,
     since timingSafeEqual throws on a length mismatch. */
  return signatures.some((sig) => {
    const sigBuf = Buffer.from(sig, 'utf8');
    return sigBuf.length === expectedBuf.length
      && crypto.timingSafeEqual(sigBuf, expectedBuf);
  });
}

/* Finds the reservation the PaymentIntent belongs to. The id was written
   onto the row when the booking was made. */
async function findReservation(paymentIntentId) {
  const query = new URLSearchParams();
  query.set('filterByFormula', `{Stripe Payment Intent}='${paymentIntentId}'`);
  query.set('maxRecords', '1');
  const data = await airtableRequest(BOARDING_BASE, TABLE, { query });
  return (data.records || [])[0] || null;
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const secret = (process.env.STRIPE_WEBHOOK_SECRET || '').trim();
  if (!secret || !stripeReady() || !airtableReady()) {
    console.warn('[stripe-webhook] not configured, ignoring event');
    /* 200 on purpose: a non 2xx makes Stripe retry for days over
       something only a deploy can fix. */
    return res.status(200).json({ ok: true, configured: false });
  }

  let body;
  try {
    body = await rawBody(req);
  } catch {
    return res.status(400).json({ error: 'Could not read body' });
  }

  if (!verifySignature(body, req.headers['stripe-signature'], secret)) {
    console.error('[stripe-webhook] signature did not verify');
    return res.status(400).json({ error: 'Invalid signature' });
  }

  let event;
  try {
    event = JSON.parse(body.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  /* Anything else is acknowledged and dropped, so Stripe stops sending
     it rather than retrying against a handler that ignores it. */
  const INTERESTING = new Set([
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'charge.refunded',
  ]);
  if (!INTERESTING.has(event.type)) {
    return res.status(200).json({ ok: true, ignored: event.type });
  }

  const object = (event.data && event.data.object) || {};
  const intentId = event.type === 'charge.refunded'
    ? str(object.payment_intent, 80)
    : str(object.id, 80);

  if (!/^pi_[A-Za-z0-9]+$/.test(intentId)) {
    return res.status(200).json({ ok: true, note: 'no payment intent on event' });
  }

  try {
    /* The authoritative read. Whatever the event body claimed, this is
       what Stripe says right now. */
    const intent = await stripeRequest(`/payment_intents/${intentId}`, { method: 'GET' });

    const row = await findReservation(intentId);
    if (!row) {
      console.warn(`[stripe-webhook] no reservation for ${intentId}`);
      return res.status(200).json({ ok: true, note: 'no matching reservation' });
    }

    let fields = null;
    if (intent.status === 'succeeded') {
      /* Already stamped: Stripe retries, and a second run must not move
         a booking somebody has since confirmed or cancelled by hand. */
      if (row.fields && row.fields['Deposit Paid On']) {
        return res.status(200).json({ ok: true, note: 'already recorded' });
      }
      fields = {
        'Status': 'Deposit Paid',
        'Deposit Paid On': new Date().toISOString(),
      };
    } else if (event.type === 'charge.refunded') {
      fields = { 'Status': 'Cancelled' };
    } else if (intent.status === 'requires_payment_method') {
      /* The card was declined. The booking stays Pending so it shows up
         as somebody to chase rather than quietly disappearing. */
      console.warn(`[stripe-webhook] payment failed for ${intentId}`);
      return res.status(200).json({ ok: true, note: 'payment failed, left pending' });
    }

    if (fields) {
      /* Records array, not a table/recordId path: the helper encodes the
         table name, so a slash in it becomes %2F and Airtable 403s. */
      await airtableRequest(BOARDING_BASE, TABLE, {
        method: 'PATCH',
        body: { records: [{ id: row.id, fields }], typecast: true },
      });
      console.log(`[stripe-webhook] ${event.type} -> ${row.id} ${JSON.stringify(fields)}`);
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[stripe-webhook] failed:', err && err.message);
    /* 500 so Stripe retries: this is the transient sort of failure that
       a retry genuinely fixes. */
    return res.status(500).json({ error: 'Webhook handling failed' });
  }
}

module.exports = handler;
/* Set after the export above, not before: assigning module.exports a
   second time would throw this away, and body parsing would silently
   come back on. Signature verification would then fail for every event. */
module.exports.config = { api: { bodyParser: false } };
