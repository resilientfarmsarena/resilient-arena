'use strict';

/* The email the office gets when someone applies for a job.

   Sent by api/apply.js once Airtable has confirmed the application is
   saved, through Resend, the service the Arena app already sends with.
   One email per saved application: the candidate's record ID goes to
   Resend as the idempotency key, so a retry of the same save cannot
   produce a second copy.

   THE EMAIL NEVER COSTS AN APPLICATION. Nothing in here throws. A
   missing key, a refusal from Resend or a slow answer is logged and
   that is all: the application is already saved and the applicant
   still sees the normal thank-you.

   It carries the few answers needed to pick up the phone, and a link to
   the app for the rest. No resume, and none of the office-only columns
   (Rating, Interview Date, Internal Notes): this function is only ever
   handed what the applicant typed. */

const RESEND_KEY = process.env.RESEND_API_KEY || '';
const TO   = process.env.APPLICATION_NOTIFY_EMAIL || 'info@resilientarena.com';
const FROM = process.env.APPLICATION_NOTIFY_FROM  || 'Resilient Arena <info@resilientarena.com>';

/* The app has no link that opens one job or one application. */
const APP_JOBS_URL = 'https://app.resilientarena.com/jobs';

/* Resend normally answers in well under a second. */
const TIMEOUT_MS = 8000;

const WHEN = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  month: 'short', day: 'numeric', year: 'numeric',
  hour: 'numeric', minute: '2-digit',
});

/* (325) 555-0142 when there are ten digits, otherwise as typed. */
function prettyPhone(phone) {
  const d = phone.replace(/\D/g, '');
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : phone;
}

/* Names and towns are typed by strangers. Keep each on its own line. */
function oneLine(v) {
  return String(v || '').replace(/\s+/g, ' ').trim();
}

/* a: { applicant, jobTitle, phone, okToText, email, city, appliedOn }.
   A line whose answer is missing is left out rather than printed empty. */
function applicationEmail(a) {
  const applicant = oneLine(a.applicant);
  const jobTitle  = oneLine(a.jobTitle);
  const phone     = oneLine(a.phone);
  const email     = oneLine(a.email);
  const city      = oneLine(a.city);

  const facts = [
    phone && `Phone: ${prettyPhone(phone)} (OK to text: ${a.okToText ? 'Yes' : 'No'})`,
    email && `Email: ${email}`,
    city  && `Lives in: ${city}`,
    `Applied: ${WHEN.format(a.appliedOn || new Date())}`,
  ].filter(Boolean);

  const message = {
    from: FROM,
    to: [TO],
    subject: jobTitle
      ? `New application: ${applicant} for ${jobTitle}`
      : `New application: ${applicant}`,
    text: [
      jobTitle ? `${applicant} applied for ${jobTitle}.` : `${applicant} sent in an application.`,
      '',
      ...facts,
      '',
      'See the full application in the app:',
      APP_JOBS_URL,
      '',
    ].join('\n'),
  };
  /* Reply writes to the applicant, when they gave an address. */
  if (email) message.reply_to = email;
  return message;
}

/* Resolves true when Resend took the email, false otherwise. */
async function sendApplicationEmail(recordId, a) {
  if (!RESEND_KEY) {
    console.warn(`[apply] RESEND_API_KEY not set, no email sent for ${recordId}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `application-${recordId}`,
      },
      body: JSON.stringify(applicationEmail(a)),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const why = (await res.text().catch(() => '')).slice(0, 300);
      console.error(`[apply] saved ${recordId} but the email was refused (${res.status}): ${why}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[apply] saved ${recordId} but the email did not send:`, e && e.message);
    return false;
  }
}

module.exports = { applicationEmail, sendApplicationEmail };
