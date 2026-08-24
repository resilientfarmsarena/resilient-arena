'use strict';

/* POST /api/waitlist
   Backs "Ask to be notified" on a leased pen in the map detail sheet.

   TABLE SETUP. Writes by column name with typecast on, so the selects
   create themselves. Defaults to "Pen Waitlist", overridable with
   AIRTABLE_WAITLIST_TABLE. Columns:

     Pen          single line text
     Pen ID       single line text     Airtable record id of the pen
     Name         single line text     required
     Phone        phone                required
     Email        email                optional
     SMS Consent  checkbox             ticked only on an explicit opt in
     Status       single select        stamped "Waiting", becomes "Notified"
     Source       single line text     stamped "Arena Site Map"
     Joined On    date with time       stamped
     Notified On  date with time       left empty, set when the pen opens

   Kept in its own table rather than folded into Pen Inquiries because a
   waitlist entry has a lifecycle: it stays open until the pen frees up
   and somebody is told, which is what Status and Notified On track.

   HOW THE LIST WORKS. Everyone waiting on a pen is notified at the same
   time when it frees up, and the first to respond gets it. The sheet says
   so before anyone joins, so the race is stated up front rather than
   being a surprise. There is no queue position to maintain as a result.

   WHAT THIS DOES NOT DO YET. Sending the notification. The rows now carry
   a name and a phone number, so there is somebody to reach, but the send
   channel itself, email or SMS, is still an open decision. Until then
   this records who is waiting on which pen and Notified On stays empty. */

const {
  BOARDING_BASE, airtableRequest, sendError, methodGuard, readJsonBody, str,
} = require('./_airtable');

const TABLE = process.env.AIRTABLE_WAITLIST_TABLE || 'Pen Waitlist';

function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;

  const b = readJsonBody(req);
  const penName = str(b.penName, 200);
  const name    = str(b.name, 120);
  const email   = str(b.email, 160);
  const phone   = str(b.phone, 40);

  /* Sample pens use s1..s8 and must not be written in as live records. */
  const rawId = str(b.penId, 40);
  const penId = /^rec[A-Za-z0-9]{14}$/.test(rawId) ? rawId : '';

  const bad = [];
  if (!penName && !penId) bad.push('penName');
  if (!name) bad.push('name');
  if (phone.replace(/\D/g, '').length < 10) bad.push('phone');
  if (email && !isEmail(email)) bad.push('email');
  if (bad.length) {
    return res.status(400).json({ error: 'Invalid waitlist entry', fields: bad });
  }

  const fields = {
    'Pen':       penName,
    'Pen ID':    penId,
    'Name':      name,
    'Phone':     phone,
    /* The notifier will not text a row without this ticked. Somebody who
       joined without opting in needs a phone call instead. */
    'SMS Consent': b.smsConsent === true || b.smsConsent === 'true',
    'Status':    'Waiting',
    'Source':    'Arena Site Map',
    'Joined On': new Date().toISOString(),
  };
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
      console.warn('[waitlist] AIRTABLE_TOKEN not set, entry not saved');
      return res.status(200).json({ ok: true, stored: false });
    }
    return sendError(res, err);
  }
};
