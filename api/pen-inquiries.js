'use strict';

/* POST /api/pen-inquiries
   Backs the two buttons in the map detail sheet:
     kind: 'lease'    -> "Request to lease", carries a lease start date
     kind: 'question' -> "Ask a question",   carries the question text

   Both land in one table so they can be worked from a single view.

   TABLE SETUP. This writes by column name, the same way Arena
   Reservations does, with typecast on so the single selects create
   themselves on first write. The table defaults to "Pen Requests" and
   is overridable with AIRTABLE_INQUIRIES_TABLE. Columns:

     Pen           single line text
     Pen ID        single line text     Airtable record id of the pen
     Request       single select        Lease request | Question
     Lease Start   date                 lease requests only
     Question      long text            questions only
     First Name    single line text     required
     Last Name     single line text     required
     Full Name     single line text     written by this function
     Phone         phone                required
     Email         email                optional
     SMS Consent   checkbox             ticked only on an explicit opt in
     Status        single select        stamped "New"
     Source        single line text     stamped "Arena Site Map"
     Submitted On  date with time       stamped

   Name and phone are required, because without them an inquiry cannot be
   answered. Email is optional: plenty of people out here would rather get
   a call back than an email. */

const {
  BOARDING_BASE, airtableRequest, sendError, methodGuard, readJsonBody, str,
} = require('./_airtable');

const TABLE = process.env.AIRTABLE_INQUIRIES_TABLE || 'Pen Requests';

const KIND_LABEL = { lease: 'Lease request', question: 'Question' };

function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

function validDate(v) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return null;
  return v;
}

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;

  const b = readJsonBody(req);

  const kind     = str(b.kind, 20);
  const penName  = str(b.penName, 200);
  const question = str(b.question, 5000);
  const firstName = str(b.firstName, 80);
  const lastName  = str(b.lastName, 80);
  const email    = str(b.email, 160);
  const phone    = str(b.phone, 40);

  const bad = [];
  if (!Object.prototype.hasOwnProperty.call(KIND_LABEL, kind)) bad.push('kind');
  if (!firstName) bad.push('firstName');
  if (!lastName) bad.push('lastName');
  if (phone.replace(/\D/g, '').length < 10) bad.push('phone');
  if (email && !isEmail(email)) bad.push('email');
  if (bad.length) {
    return res.status(400).json({ error: 'Invalid inquiry', fields: bad });
  }

  /* Only accept a real Airtable record id. Sample pens use s1..s8 and
     must not be written in as if they were live records. */
  const rawId = str(b.penId, 40);
  const penId = /^rec[A-Za-z0-9]{14}$/.test(rawId) ? rawId : '';

  const fields = {
    'Pen':          penName,
    'Pen ID':       penId,
    'Request':      KIND_LABEL[kind],
    'First Name':   firstName,
    'Last Name':    lastName,
    /* Joined for the row label. First Name is the one to greet with. */
    'Full Name':    `${firstName} ${lastName}`,
    'Phone':        phone,
    /* A phone number is required so we can call. Texting needs a separate,
       deliberate tick, so never infer consent from the number alone. */
    'SMS Consent':  b.smsConsent === true || b.smsConsent === 'true',
    'Status':       'New',
    'Source':       'Arena Site Map',
    'Submitted On': new Date().toISOString(),
  };

  if (kind === 'lease') {
    const start = validDate(str(b.leaseStart, 10));
    if (!start) return res.status(400).json({ error: 'Invalid inquiry', fields: ['leaseStart'] });
    fields['Lease Start'] = start;
  } else {
    if (!question) return res.status(400).json({ error: 'Invalid inquiry', fields: ['question'] });
    fields['Question'] = question;
  }

  if (email) fields['Email'] = email;

  try {
    const data = await airtableRequest(BOARDING_BASE, TABLE, {
      method: 'POST',
      body: { records: [{ fields }], typecast: true },
    });
    const id = data.records && data.records[0] && data.records[0].id;
    return res.status(201).json({ ok: true, id });
  } catch (err) {
    if (err && err.code === 'NOT_CONFIGURED') {
      /* No token yet. The sheet shows its confirmation exactly as the
         prototype did, and nothing is stored. */
      console.warn('[pen-inquiries] AIRTABLE_TOKEN not set, inquiry not saved');
      return res.status(200).json({ ok: true, stored: false });
    }
    return sendError(res, err);
  }
};
