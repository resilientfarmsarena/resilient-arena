'use strict';

/* GET /api/notify-waitlist
   Cron. Texts everyone waiting on a pen the moment that pen is Available.

   HOW "ON STATUS CHANGE" WORKS WITHOUT CHANGE DETECTION.
   There is no diffing and no stored previous state. Each run asks two
   questions: which pens are Available right now, and who is still
   Waiting on one of them. Anybody texted is flipped to Notified with a
   Notified On stamp, so the next run no longer sees them. The stamp is
   the idempotency: a pen can sit Available for a week and nobody gets a
   second message. If the pen is leased again and new people join, they
   are Waiting against a Leased pen and stay quiet until it frees up.

   FAILURES DO NOT GET STAMPED. If Twilio rejects a number, that row
   stays Waiting and is retried on the next run rather than being marked
   notified and silently dropped.

   REPLIES. Messages go out from a Twilio number that has no inbound
   webhook, so a reply reaches Twilio and stops there. The copy below
   says so and points people at the phone line instead. Wire an inbound
   handler if replies should land somewhere. */

const {
  BOARDING_BASE, airtableRequest, isConfigured, str,
} = require('./_airtable');

const PENS_TABLE     = process.env.AIRTABLE_PENS_TABLE     || 'Stalls, Traps, Pastures';
const WAITLIST_TABLE = process.env.AIRTABLE_WAITLIST_TABLE || 'Pen Waitlist';

const PEN_NAME_FIELD = 'fldROk5FxumDucS4x';
const CALL_NUMBER    = process.env.ARENA_PHONE || '(325) 627-3726';

/* {pen} is replaced with the pen name. Kept in one place so the wording
   can change without touching the logic. */
const TEMPLATE = process.env.WAITLIST_SMS_TEMPLATE
  || 'Resilient Arena: {pen} is open. Everyone waiting was texted at once, '
   + 'first to reach us gets it. Call ' + CALL_NUMBER + '. '
   + 'Replies to this number are not read. Reply STOP to opt out.';

/* A runaway loop here costs money and annoys people, so cap each run. */
const MAX_PER_RUN = Number(process.env.WAITLIST_MAX_PER_RUN || 200);

const TWILIO_SID   = process.env.TWILIO_ACCOUNT_SID || '';
const TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN || '';
const TWILIO_FROM  = process.env.TWILIO_FROM_NUMBER || '';
const TWILIO_MSID  = process.env.TWILIO_MESSAGING_SERVICE_SID || '';

function twilioReady() {
  return Boolean(TWILIO_SID && TWILIO_TOKEN && (TWILIO_FROM || TWILIO_MSID));
}

/* Twilio wants E.164. Everything collected on the site is a US number
   typed as (325) 627-3726, so add +1 when it is a bare 10 digits. */
function toE164(raw) {
  const d = String(raw || '').replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  if (String(raw).trim().startsWith('+') && d.length >= 8) return `+${d}`;
  return null;
}

async function sendSms(to, body) {
  const params = new URLSearchParams();
  params.set('To', to);
  params.set('Body', body);
  if (TWILIO_MSID) params.set('MessagingServiceSid', TWILIO_MSID);
  else params.set('From', TWILIO_FROM);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    }
  );

  const text = await res.text();
  if (!res.ok) {
    /* Log the Twilio error code, never the credentials. */
    console.error(`[notify-waitlist] Twilio ${res.status}: ${text.slice(0, 300)}`);
    throw new Error(`Twilio responded ${res.status}`);
  }
  try { return JSON.parse(text).sid; } catch { return null; }
}

async function availablePenNames() {
  const byId = new Map();
  let offset;
  do {
    const query = new URLSearchParams();
    query.set('filterByFormula', "{Status}='Available'");
    query.append('fields[]', PEN_NAME_FIELD);
    if (offset) query.set('offset', offset);
    const data = await airtableRequest(BOARDING_BASE, PENS_TABLE, { query });
    (data.records || []).forEach((r) => {
      byId.set(r.id, (r.fields || {})[PEN_NAME_FIELD] || '');
    });
    offset = data.offset;
  } while (offset);
  return byId;
}

async function waitingEntries() {
  const rows = [];
  let offset;
  do {
    const query = new URLSearchParams();
    query.set('filterByFormula', "{Status}='Waiting'");
    ['Pen', 'Pen ID', 'Name', 'Phone'].forEach((f) => query.append('fields[]', f));
    if (offset) query.set('offset', offset);
    const data = await airtableRequest(BOARDING_BASE, WAITLIST_TABLE, { query });
    (data.records || []).forEach((r) => rows.push({ id: r.id, f: r.fields || {} }));
    offset = data.offset;
  } while (offset && rows.length < 5000);
  return rows;
}

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!secret) console.warn('[notify-waitlist] CRON_SECRET is not set, endpoint is unauthenticated');

  const report = { ranAt: new Date().toISOString(), sent: 0, failed: 0, skipped: 0 };

  /* Spread the report first: a later key would otherwise be clobbered by
     the counters and a misconfiguration would read as a normal quiet run. */
  if (!isConfigured()) {
    console.warn('[notify-waitlist] AIRTABLE_TOKEN not set, nothing sent');
    return res.status(200).json({ ok: true, ...report, skippedReason: 'no airtable token' });
  }
  if (!twilioReady()) {
    console.warn('[notify-waitlist] Twilio not configured, nothing sent');
    return res.status(200).json({ ok: true, ...report, skippedReason: 'twilio not configured' });
  }

  try {
    const openPens = await availablePenNames();
    if (openPens.size === 0) {
      return res.status(200).json({ ok: true, ...report, note: 'no available pens' });
    }

    const waiting = (await waitingEntries()).filter((r) => openPens.has(str(r.f['Pen ID'], 40)));
    const batch = waiting.slice(0, MAX_PER_RUN);
    if (waiting.length > batch.length) {
      report.deferred = waiting.length - batch.length;
      console.warn(`[notify-waitlist] capped at ${MAX_PER_RUN}, ${report.deferred} deferred to next run`);
    }

    const stampedAt = new Date().toISOString();
    const stamped = [];

    for (const row of batch) {
      const penId = str(row.f['Pen ID'], 40);
      const pen = openPens.get(penId) || str(row.f['Pen'], 200) || 'A pen';
      const to = toE164(row.f['Phone']);

      if (!to) {
        report.skipped++;
        console.warn(`[notify-waitlist] unusable phone on ${row.id}, left Waiting`);
        continue;
      }

      try {
        await sendSms(to, TEMPLATE.replace('{pen}', pen));
        stamped.push({ id: row.id, fields: { Status: 'Notified', 'Notified On': stampedAt } });
        report.sent++;
      } catch (e) {
        /* Left Waiting on purpose so the next run tries again. */
        report.failed++;
      }
    }

    for (let i = 0; i < stamped.length; i += 10) {
      await airtableRequest(BOARDING_BASE, WAITLIST_TABLE, {
        method: 'PATCH',
        body: { records: stamped.slice(i, i + 10), typecast: true },
      });
    }

    console.log('[notify-waitlist]', JSON.stringify(report));
    return res.status(200).json({ ok: true, ...report });
  } catch (err) {
    console.error('[notify-waitlist] failed:', err && err.message);
    return res.status(500).json({ ok: false, error: 'Notify sweep failed', ...report });
  }
};
