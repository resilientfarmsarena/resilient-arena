'use strict';

/* POST /api/boarding-request
   The boarding request form on resilientarena.com.

   Writes one row to "Boarder Requests", the intake table the office
   already works from. Nothing here invents a new shape: every column and
   every select option below is what the table already offers, so a
   request that arrives from the website sits alongside one typed in by
   hand and the same views and filters cover both.

   "Add as Boarder?" is deliberately not written. That is the office's
   call after reading the request, not something the applicant decides.

   CONSENT. A phone number is required so we can call about the horses,
   which is not permission to text. SMS Consent is written only when the
   applicant ticks the box, and it carries across to the Boarders record
   when the request is converted, so the boarding app knows whether it
   may text them. */

const {
  BOARDING_BASE, airtableRequest, sendError, methodGuard, readJsonBody, str,
} = require('./_airtable');

const TABLE = process.env.AIRTABLE_BOARDER_REQUESTS_TABLE || 'Boarder Requests';

/* Mirrors the single selects on the table. Anything not on these lists is
   dropped rather than written, so a hand crafted request cannot create a
   new option and quietly pollute the field. */
const BOARDING_LENGTHS = new Set(['Overnight', 'Under 30 days', 'Ongoing / month to month']);
const YES_NO           = new Set(['Yes', 'No']);
const STATES = new Set([
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado',
  'Connecticut', 'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho',
  'Illinois', 'Indiana', 'Iowa', 'Kansas', 'Kentucky', 'Louisiana', 'Maine',
  'Maryland', 'Massachusetts', 'Michigan', 'Minnesota', 'Mississippi',
  'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 'New Jersey',
  'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina',
  'South Dakota', 'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia',
  'Washington', 'West Virginia', 'Wisconsin', 'Wyoming',
]);

function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

/* YYYY-MM-DD and a real calendar date. Arrival may be in the past: people
   ask about a horse already on the way. */
function validDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  return v;
}

/* Only writes the key when there is something to write, so an untouched
   optional field is left empty rather than being set to a blank string. */
function put(fields, key, value) {
  if (value !== '' && value !== null && value !== undefined) fields[key] = value;
}

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;

  const b = readJsonBody(req);

  const firstName = str(b.firstName, 80);
  const lastName  = str(b.lastName, 80);
  const email     = str(b.email, 160);
  const phone     = str(b.phone, 40);

  const bad = [];
  if (!firstName) bad.push('firstName');
  if (!lastName) bad.push('lastName');
  if (!isEmail(email)) bad.push('email');
  if (phone.replace(/\D/g, '').length < 10) bad.push('phone');

  const horses = Number.parseInt(b.horses, 10);
  if (!Number.isInteger(horses) || horses < 1 || horses > 99) bad.push('horses');

  const length = str(b.boardingLength, 40);
  if (!BOARDING_LENGTHS.has(length)) bad.push('boardingLength');

  if (bad.length) {
    return res.status(400).json({ error: 'Invalid boarding request', fields: bad });
  }

  const fields = {
    'Request Type':   'Boarding',
    'Request Status': 'Pending',
    'First Name':     firstName,
    'Last Name':      lastName,
    'Email':          email,
    'Phone':          phone,
    'Number of Horses': horses,
    'Boarding Length':  length,
    'SMS Consent':    b.smsConsent === true || b.smsConsent === 'true',
  };

  put(fields, 'Address',  str(b.address, 200));
  put(fields, 'City',     str(b.city, 100));
  put(fields, 'Zipcode',  str(b.zip, 20));
  put(fields, 'Accommodation requirements', str(b.accommodation, 3000));
  put(fields, 'Notes',    str(b.notes, 5000));
  /* Set when they arrived from a pin on the map. Records what prompted
     the request; it does not reserve that pen. */
  put(fields, 'Pen of Interest', str(b.pen, 200));

  const state = str(b.state, 40);
  if (STATES.has(state)) fields['State'] = state;

  /* One horse cannot be stalled with anything, so the question is only
     asked, and only recorded, when there is more than one. */
  const together = str(b.stalledTogether, 10);
  if (horses > 1 && YES_NO.has(together)) fields['Stalled together?'] = together;

  const lq = str(b.lqPlugIn, 10);
  if (YES_NO.has(lq)) fields['LQ Plug In?'] = lq;

  const studs = str(b.studs, 10);
  if (YES_NO.has(studs)) fields['Studs?'] = studs;

  const arrival = validDate(str(b.arrival, 10));
  if (arrival) fields['Estimated Arrival Date'] = arrival;

  const departure = validDate(str(b.departure, 10));
  if (departure) fields['Estimated Departure Date'] = departure;

  try {
    const data = await airtableRequest(BOARDING_BASE, TABLE, {
      method: 'POST',
      body: { records: [{ fields }], typecast: true },
    });
    const id = data.records && data.records[0] && data.records[0].id;
    return res.status(201).json({ ok: true, id });
  } catch (err) {
    if (err && err.code === 'NOT_CONFIGURED') {
      console.warn('[boarding-request] AIRTABLE_TOKEN not set, request not saved');
      return res.status(200).json({ ok: true, stored: false });
    }
    return sendError(res, err);
  }
};
