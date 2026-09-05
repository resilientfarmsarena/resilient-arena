'use strict';

/* POST /api/pen-hold
   Holds a pen with a deposit, for a start date up to 30 days out.

   THE PEN IS NOT HELD UNTIL THE MONEY LANDS. This creates the row in Pen
   Reservations with no Reserved date, which leaves the Status formula on
   that table blank and the pen untouched. Only the Stripe webhook, once
   the deposit actually clears, stamps Reserved date and moves the pen to
   Hold / Reserved. So somebody who abandons checkout costs nothing and
   blocks nobody, and there is no timer racing to clean up after them.

   WHY NOT WRITE Start date. The Status formula on Pen Reservations reads
   Start date as "they are in it now". Writing a date a fortnight out
   would show the pen as occupied today. The requested date goes in
   Requested Start; Start date is for when the stay actually begins.

   MONEY IS COMPUTED HERE. The deposit is half the pen's monthly price
   read from Airtable at the moment of booking. Nothing about the amount
   comes from the browser. */

const {
  BOARDING_BASE, airtableRequest, sendError, methodGuard, readJsonBody, str,
} = require('./_airtable');
const stripeLib = require('./_stripe');

const RESERVATIONS = process.env.AIRTABLE_PEN_RESERVATIONS_TABLE || 'Pen Reservations';
const PENS         = process.env.AIRTABLE_PENS_TABLE || 'Stalls, Traps, Pastures';

/* Field ids on Stalls, Traps, Pastures. Ids rather than names so a
   rename in Airtable does not silently break the read. */
const PEN_STATUS = 'fldDt32wGukq0j3y1';
const PEN_PRICE  = 'fldFRDFwRWHPwhxRV';
/* The name the map shows, the same field pens.js and notify-waitlist.js
   read. The other name field on this table holds a short code, and a
   receipt for CB-S-002 does not match the pen they clicked. */
const PEN_NAME   = 'fldROk5FxumDucS4x';

/* Half the first month, matching the arena rental rule. One deposit
   convention for the whole business. */
const DEPOSIT_PCT = Number(process.env.PEN_DEPOSIT_PCT || 0.5);

/* How far ahead somebody may book. Anything further out belongs on the
   waitlist, which already texts people the day a pen frees up. */
const MAX_DAYS_AHEAD = Number(process.env.PEN_MAX_DAYS_AHEAD || 30);

function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
function isRecordId(v) { return /^rec[A-Za-z0-9]{14}$/.test(v); }

/* Days between today and a YYYY-MM-DD date, in whole days, UTC, so a
   late evening booking does not read as yesterday. Returns null when the
   string is not a real calendar date. */
function daysFromToday(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((d.getTime() - today) / 86400000);
}

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;

  const b = readJsonBody(req);

  const firstName = str(b.firstName, 80);
  const lastName  = str(b.lastName, 80);
  const email     = str(b.email, 160);
  const phone     = str(b.phone, 40);
  const notes     = str(b.notes, 2000);
  const penId     = str(b.penId, 40);
  const startDate = str(b.startDate, 10);

  const bad = [];
  if (!firstName) bad.push('firstName');
  if (!lastName) bad.push('lastName');
  if (!isEmail(email)) bad.push('email');
  if (phone.replace(/\D/g, '').length < 10) bad.push('phone');
  if (!isRecordId(penId)) bad.push('penId');

  const days = daysFromToday(startDate);
  if (days === null || days < 0 || days > MAX_DAYS_AHEAD) bad.push('startDate');

  if (bad.length) {
    return res.status(400).json({ error: 'Invalid reservation', fields: bad });
  }

  try {
    /* Read the pen straight from Airtable. The browser told us which pen
       it wants; it does not get to tell us the price or that it is free. */
    const query = new URLSearchParams();
    query.set('filterByFormula', `RECORD_ID()='${penId}'`);
    query.set('returnFieldsByFieldId', 'true');
    query.set('maxRecords', '1');
    const found = await airtableRequest(BOARDING_BASE, PENS, { query });
    const pen = (found.records || [])[0];

    if (!pen) {
      return res.status(404).json({ error: 'That space could not be found.' });
    }

    const f = pen.fields || {};
    const status = str(f[PEN_STATUS], 40);
    if (status !== 'Available') {
      /* Somebody took it while this form was open. 409 so the page knows
         to refresh the map rather than just showing a message. */
      return res.status(409).json({ error: 'That space is no longer available.' });
    }

    const rate = Number(f[PEN_PRICE]);
    if (!Number.isFinite(rate) || rate <= 0) {
      console.error(`[pen-hold] ${penId} has no usable monthly price`);
      return res.status(409).json({ error: 'That space cannot be booked online. Please call us.' });
    }

    const penName = str(f[PEN_NAME], 200) || 'Pen';
    const deposit = Math.round(rate * DEPOSIT_PCT * 100) / 100;

    /* Created without a Reserved date on purpose: the Status formula
       stays blank and the pen stays open until the deposit clears. */
    const created = await airtableRequest(BOARDING_BASE, RESERVATIONS, {
      method: 'POST',
      body: {
        records: [{
          fields: {
            'Reservation':     `${penName} · ${firstName} ${lastName} · from ${startDate}`,
            'Pen':             [penId],
            'First Name':      firstName,
            'Last Name':       lastName,
            'Email':           email,
            'Phone':           phone,
            'SMS Consent':     b.smsConsent === true || b.smsConsent === 'true',
            'Requested Start': startDate,
            'Rate at Booking': rate,
            'Deposit':         deposit,
            'Source':          'Arena Site Map',
            'Notes':           notes,
          },
        }],
        typecast: true,
      },
    });
    const id = created.records && created.records[0] && created.records[0].id;

    /* No Stripe configured: the reservation is captured and somebody
       rings them for the deposit, the same fallback the arena uses. */
    if (!stripeLib.isConfigured()) {
      return res.status(201).json({
        ok: true, id, deposit, penName, startDate, payment: false,
      });
    }

    const intent = await stripeLib.stripeRequest('/payment_intents', {
      body: {
        amount: stripeLib.toCents(deposit),
        currency: 'usd',
        description: `Pen deposit, ${penName} from ${startDate}`,
        receipt_email: email,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        metadata: {
          kind: 'pen_hold',
          reservation_id: id,
          pen_id: penId,
          pen_name: penName,
          requested_start: startDate,
          customer_name: `${firstName} ${lastName}`,
        },
      },
      /* Keyed to the row, so a retry cannot open a second charge against
         the same reservation. */
      idempotencyKey: `pen-hold-${id}`,
    });

    await airtableRequest(BOARDING_BASE, RESERVATIONS, {
      method: 'PATCH',
      body: { records: [{ id, fields: { 'Stripe Payment Intent': intent.id } }] },
    });

    return res.status(201).json({
      ok: true,
      id,
      deposit,
      penName,
      startDate,
      payment: true,
      clientSecret: intent.client_secret,
    });
  } catch (err) {
    if (err && err.code === 'NOT_CONFIGURED') {
      console.warn('[pen-hold] AIRTABLE_TOKEN not set, reservation not saved');
      return res.status(200).json({ ok: true, stored: false });
    }
    return sendError(res, err);
  }
};
