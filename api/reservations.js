'use strict';

/* POST /api/reservations
   Writes one row to the "Arena Reservations" table.

   The page used to build the Airtable body itself and post it with the
   token attached. Now it posts a small plain payload and this function
   builds the record, so the browser no longer decides what gets written.

   Money note: the deposit is recomputed here from the rate card rather
   than trusted from the request. A tampered client cannot book a $900
   day for a $1 deposit. */

const {
  BOARDING_BASE, airtableRequest, sendError, methodGuard, readJsonBody, str,
} = require('./_airtable');
const stripeLib = require('./_stripe');

const TABLE = process.env.AIRTABLE_RESERVATIONS_TABLE || 'Arena Reservations';

/* Facility figures. These mirror the page and are final per the brief. */
const HOURLY_RATE  = 50;
const FULLDAY_RATE = 450;
const EVENT_RATE   = 750;
const DEPOSIT_PCT  = 0.5;

/* Event rental is built but not offered. Keep the server in step with
   SHOW_EVENT_RENTAL on the page so a hand crafted request cannot book one. */
const SHOW_EVENT_RENTAL = process.env.SHOW_EVENT_RENTAL === 'true';

const TYPE_LABEL = { hourly: 'Hourly', fullday: 'Full Day', event: 'Event Rental' };

function formatHour(h) {
  if (h === 12) return '12:00 PM';
  return h < 12 ? `${h}:00 AM` : `${h - 12}:00 PM`;
}

function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }
function digits(v)  { return String(v).replace(/\D/g, ''); }

/* YYYY-MM-DD, real calendar date, not in the past. */
function validDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  const today = new Date();
  const todayUtc = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  if (d.getTime() < todayUtc) return null;
  return v;
}

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;

  const b = readJsonBody(req);

  const firstName = str(b.firstName, 80);
  const lastName  = str(b.lastName, 80);
  const email     = str(b.email, 160);
  const phone     = str(b.phone, 40);
  const notes     = str(b.notes, 2000);
  const type      = str(b.type, 20);

  const errors = [];
  if (!firstName) errors.push('firstName');
  if (!lastName) errors.push('lastName');
  if (!isEmail(email)) errors.push('email');
  if (digits(phone).length < 10) errors.push('phone');
  if (!Object.prototype.hasOwnProperty.call(TYPE_LABEL, type)) errors.push('type');

  const date = validDate(str(b.date, 10));
  if (!date) errors.push('date');

  let startHour = 8;
  let duration  = 12;
  if (type === 'hourly') {
    startHour = Number.parseInt(b.startHour, 10);
    duration  = Number.parseInt(b.durationHours, 10);
    if (!Number.isInteger(startHour) || startHour < 0 || startHour > 23) errors.push('startHour');
    if (!Number.isInteger(duration) || duration < 1 || duration > 12) errors.push('durationHours');
    if (Number.isInteger(startHour) && Number.isInteger(duration) && startHour + duration > 24) {
      errors.push('durationHours');
    }
  }

  if (errors.length) {
    return res.status(400).json({ error: 'Invalid reservation', fields: errors });
  }

  if (type === 'event' && !SHOW_EVENT_RENTAL) {
    return res.status(400).json({ error: 'Event rental is not currently offered' });
  }

  /* Recomputed server side. The client's own figure is ignored. */
  const total =
    type === 'fullday' ? FULLDAY_RATE
      : type === 'event' ? EVENT_RATE
        : duration * HOURLY_RATE;
  const deposit = total * DEPOSIT_PCT;

  const timeStr =
    type === 'fullday' ? '8:00 AM - 8:00 PM'
      : type === 'event' ? '8:00 AM - 8:00 PM (Full Day Event)'
        : `${formatHour(startHour)} - ${formatHour(startHour + duration)}`;

  /* The row is written first and always as Pending. Only the webhook,
     acting on what Stripe says, is allowed to call a deposit paid. That
     way a browser closed halfway through leaves a booking to chase
     rather than nothing at all, and a tampered client cannot mark itself
     paid. */
  const status = 'Pending';

  try {
    const data = await airtableRequest(BOARDING_BASE, TABLE, {
      method: 'POST',
      body: {
        fields: {
          'First Name': firstName,
          'Last Name':  lastName,
          'Email':   email,
          'Phone':   phone,
          'Date':    date,
          'Time':    timeStr,
          'Type':    TYPE_LABEL[type],
          'Deposit': deposit,
          'Status':  status,
          'Notes':   notes,
          'SMS Consent': b.smsConsent === true || b.smsConsent === 'true',
        },
      },
    });

    const id = data.id;

    /* No Stripe configured: behave exactly as the site did before there
       was a card field, so the booking is still captured and somebody
       rings them for the deposit. */
    if (!stripeLib.isConfigured()) {
      return res.status(201).json({ ok: true, id, deposit, time: timeStr, payment: false });
    }

    /* The amount comes from the rate card above, never from the request,
       so the page cannot ask to be charged a dollar for a $900 day. */
    const intent = await stripeLib.stripeRequest('/payment_intents', {
      body: {
        amount: stripeLib.toCents(deposit),
        currency: 'usd',
        description: `Arena deposit, ${TYPE_LABEL[type]} on ${date}`,
        receipt_email: email,
        automatic_payment_methods: { enabled: true, allow_redirects: 'never' },
        metadata: {
          reservation_id: id,
          reservation_date: date,
          reservation_time: timeStr,
          reservation_type: TYPE_LABEL[type],
          customer_name: `${firstName} ${lastName}`,
        },
      },
      /* Keyed on the row we just made, so a retry cannot open a second
         PaymentIntent against the same booking. */
      idempotencyKey: `reservation-${id}`,
    });

    /* Written back so the webhook can find this row from the event. */
    await airtableRequest(BOARDING_BASE, `${TABLE}/${id}`, {
      method: 'PATCH',
      body: { fields: { 'Stripe Payment Intent': intent.id } },
    });

    return res.status(201).json({
      ok: true,
      id,
      deposit,
      time: timeStr,
      payment: true,
      clientSecret: intent.client_secret,
    });
  } catch (err) {
    /* No token yet: the page still shows its confirmation panel, the
       same as it did before this endpoint existed. */
    if (err && err.code === 'NOT_CONFIGURED') {
      return res.status(200).json({ ok: true, stored: false, deposit, time: timeStr });
    }
    return sendError(res, err);
  }
};
