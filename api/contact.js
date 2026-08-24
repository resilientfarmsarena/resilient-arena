'use strict';

/* POST /api/contact
   The "Need More Info?" form at the bottom of the arena site.

   TABLE SETUP. Writes by column name with typecast on, so the selects
   create themselves on first write. Defaults to "Contact Inquiries",
   overridable with AIRTABLE_CONTACT_TABLE. Columns:

     First Name    single line text     required
     Last Name     single line text     required
     Full Name     single line text     written by this function
     Email         email                required
     Phone         phone                required
     Interested In single select        Boarding | Arena Rental | General Inquiry
     Notes         long text            required
     SMS Consent   checkbox             ticked only on an explicit opt in
     Status        single select        stamped "New"
     Source        single line text     stamped "Arena Site Contact Form"
     Submitted On  date with time       stamped

   Unlike the map sheets, this form asks for an email and requires it, so
   all three contact columns are mandatory here. That matches what the
   page already validates. */

const {
  BOARDING_BASE, airtableRequest, sendError, methodGuard, readJsonBody, str,
} = require('./_airtable');

const TABLE = process.env.AIRTABLE_CONTACT_TABLE || 'Contact Inquiries';

/* Mirrors the select on the page. Anything else is recorded as General
   Inquiry rather than being allowed to create a new option. */
const INTERESTS = new Set(['Boarding', 'Arena Rental', 'General Inquiry']);

function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;

  const b = readJsonBody(req);

  const firstName = str(b.firstName, 80);
  const lastName  = str(b.lastName, 80);
  const email   = str(b.email, 160);
  const phone   = str(b.phone, 40);
  const notes   = str(b.notes, 5000);
  const rawType = str(b.interest, 60);
  const interest = INTERESTS.has(rawType) ? rawType : 'General Inquiry';

  const bad = [];
  if (!firstName) bad.push('firstName');
  if (!lastName) bad.push('lastName');
  if (!isEmail(email)) bad.push('email');
  if (phone.replace(/\D/g, '').length < 10) bad.push('phone');
  if (!notes) bad.push('notes');
  if (bad.length) {
    return res.status(400).json({ error: 'Invalid inquiry', fields: bad });
  }

  const fields = {
    'First Name':    firstName,
    'Last Name':     lastName,
    /* Primary field, so it labels the row. Greet with First Name. */
    'Full Name':     `${firstName} ${lastName}`,
    'Email':         email,
    'Phone':         phone,
    'Interested In': interest,
    'Notes':         notes,
    'SMS Consent':   b.smsConsent === true || b.smsConsent === 'true',
    'Status':        'New',
    'Source':        'Arena Site Contact Form',
    'Submitted On':  new Date().toISOString(),
  };

  try {
    const data = await airtableRequest(BOARDING_BASE, TABLE, {
      method: 'POST',
      body: { records: [{ fields }], typecast: true },
    });
    const id = data.records && data.records[0] && data.records[0].id;
    return res.status(201).json({ ok: true, id });
  } catch (err) {
    if (err && err.code === 'NOT_CONFIGURED') {
      console.warn('[contact] AIRTABLE_TOKEN not set, inquiry not saved');
      return res.status(200).json({ ok: true, stored: false });
    }
    return sendError(res, err);
  }
};
