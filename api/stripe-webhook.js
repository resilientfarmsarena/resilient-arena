'use strict';

/* POST /api/stripe-webhook
   Stripe tells us a deposit cleared; this is the only thing allowed to
   say a reservation is paid. It covers both kinds: an arena rental in
   Arena Reservations, and a pen hold in Pen Reservations. A pen hold
   also moves the pen itself to Hold / Reserved, which is the only place
   on the whole site that writes to Stalls, Traps, Pastures.

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
const PEN_RESERVATIONS = process.env.AIRTABLE_PEN_RESERVATIONS_TABLE || 'Pen Reservations';
const PENS = process.env.AIRTABLE_PENS_TABLE || 'Stalls, Traps, Pastures';
const PEN_STATUS_FIELD = 'fldDt32wGukq0j3y1';

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

/* Finds the row a PaymentIntent belongs to. Two tables take deposits
   now, so both are searched and the answer says which one matched. */
async function findByIntent(table, paymentIntentId) {
  const query = new URLSearchParams();
  query.set('filterByFormula', `{Stripe Payment Intent}='${paymentIntentId}'`);
  query.set('maxRecords', '1');
  const data = await airtableRequest(BOARDING_BASE, table, { query });
  return (data.records || [])[0] || null;
}

async function findReservation(paymentIntentId) {
  const arena = await findByIntent(TABLE, paymentIntentId);
  if (arena) return { kind: 'arena', table: TABLE, row: arena };
  const pen = await findByIntent(PEN_RESERVATIONS, paymentIntentId);
  if (pen) return { kind: 'pen', table: PEN_RESERVATIONS, row: pen };
  return null;
}

/* Takes the pen off the market. Only ever called after Stripe has
   confirmed the money, and it re reads the pen first: two people can
   reach checkout for the same space, and the second one must not
   overwrite a hold the first one already paid for. The deposit is still
   recorded either way, because it was still taken. */
async function holdPen(penRecordId) {
  const query = new URLSearchParams();
  query.set('filterByFormula', `RECORD_ID()='${penRecordId}'`);
  query.set('returnFieldsByFieldId', 'true');
  query.set('maxRecords', '1');
  const found = await airtableRequest(BOARDING_BASE, PENS, { query });
  const pen = (found.records || [])[0];
  if (!pen) return { moved: false, reason: 'pen not found' };

  const status = ((pen.fields || {})[PEN_STATUS_FIELD] || '').toString();
  if (status !== 'Available') {
    return { moved: false, reason: `pen was ${status || 'blank'}, not Available` };
  }

  await airtableRequest(BOARDING_BASE, PENS, {
    method: 'PATCH',
    body: { records: [{ id: penRecordId, fields: { 'Status': 'Hold / Reserved' } }], typecast: true },
  });
  return { moved: true };
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

    const match = await findReservation(intentId);
    if (!match) {
      console.warn(`[stripe-webhook] no reservation for ${intentId}`);
      return res.status(200).json({ ok: true, note: 'no matching reservation' });
    }
    const { kind, table, row } = match;
    const rowFields = row.fields || {};

    let fields = null;
    let penResult = null;

    if (intent.status === 'succeeded') {
      /* Already stamped: Stripe retries, and a second run must not move
         a booking somebody has since confirmed or cancelled by hand. */
      if (rowFields['Deposit Paid On']) {
        return res.status(200).json({ ok: true, note: 'already recorded' });
      }

      if (kind === 'arena') {
        fields = { 'Status': 'Deposit Paid', 'Deposit Paid On': new Date().toISOString() };
      } else {
        /* A pen reservation has no Status column of its own: the formula
           on that table reads the dates. Stamping Reserved date is what
           turns the row from a half finished checkout into a real hold. */
        const now = new Date();
        fields = {
          'Deposit Paid On': now.toISOString(),
          'Reserved date': now.toISOString().slice(0, 10),
        };
        const penLink = rowFields['Pen'];
        const penRecordId = Array.isArray(penLink) ? penLink[0] : null;
        if (penRecordId) {
          penResult = await holdPen(penRecordId);
          if (!penResult.moved) {
            /* The money is real and gets recorded, but the pen is not
               ours to take. Left for the office to refund or rehouse. */
            console.error(`[stripe-webhook] deposit taken on ${row.id} but pen not held: ${penResult.reason}`);
            fields['Notes'] = [rowFields['Notes'], `Deposit taken but the pen was not held: ${penResult.reason}. Needs a refund or another space.`]
              .filter(Boolean).join('\n\n');
          }
        }
      }
    } else if (event.type === 'charge.refunded') {
      fields = kind === 'arena'
        ? { 'Status': 'Cancelled' }
        : { 'Canceled date': new Date().toISOString().slice(0, 10) };
    } else if (intent.status === 'requires_payment_method') {
      /* The card was declined. Nothing is stamped, so an arena booking
         stays Pending and a pen reservation stays unheld, either way
         showing up as somebody to chase. */
      console.warn(`[stripe-webhook] payment failed for ${intentId}`);
      return res.status(200).json({ ok: true, note: 'payment failed, nothing held' });
    }

    if (fields) {
      /* Records array, not a table/recordId path: the helper encodes the
         table name, so a slash in it becomes %2F and Airtable 403s. */
      await airtableRequest(BOARDING_BASE, table, {
        method: 'PATCH',
        body: { records: [{ id: row.id, fields }], typecast: true },
      });
      console.log(`[stripe-webhook] ${event.type} ${kind} -> ${row.id} ${JSON.stringify(fields)}`);
    }

    return res.status(200).json({ ok: true, kind, penHeld: penResult ? penResult.moved : undefined });
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
