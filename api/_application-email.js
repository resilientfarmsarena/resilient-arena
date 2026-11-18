'use strict';

/* The two emails that go out when someone applies for a job: one to the
   office, and a short confirmation to the applicant.

   Sent by api/apply.js once Airtable has confirmed the application is
   saved, through Resend, the service the Arena app already sends with.
   One of each per saved application: the candidate's record ID goes to
   Resend as the idempotency key, so a retry of the same save cannot
   produce a second copy.

   AN EMAIL NEVER COSTS AN APPLICATION. Nothing in here throws. A
   missing key, a refusal from Resend or a slow answer is logged and
   that is all: the application is already saved and the applicant
   still sees the normal thank-you.

   The office email carries the few answers needed to pick up the
   phone, and a link to the app for the rest. No resume, and none of the
   office-only columns (Rating, Interview Date, Internal Notes): this
   file is only ever handed what the applicant typed. */

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

/* The confirmation the applicant gets. Tyesha approved this wording on
   11/18, down to having no sign-off and no address under it: change it
   only with her say-so. The seven days is the same promise the form
   makes, so the two move together.

   The address it goes to was typed by a stranger and could be anyone's,
   so the only things of theirs it repeats are a first name that looks
   like a name, and nothing else they wrote. Anything odd in the name
   box and the greeting goes without one. */
const NAME_RE = /^\p{L}[\p{L}' -]{0,39}$/u;

function confirmationEmail(a) {
  const jobTitle = oneLine(a.jobTitle);
  const typed = oneLine(a.firstName);
  const first = NAME_RE.test(typed) ? typed : '';

  return {
    from: FROM,
    to: [oneLine(a.email)],
    /* A reply reaches the office. */
    reply_to: TO,
    subject: first ? `We got your application, ${first}` : 'We got your application',
    text: [
      first ? `Hi ${first},` : 'Hello,',
      '',
      `Thank you for applying ${jobTitle ? `for ${jobTitle} ` : ''}at Resilient Arena. Your application came through and we have it.`,
      '',
      'We read every one. You will hear back from us within seven days.',
      '',
      'If anything changes, or you need to add something, just reply to this email.',
      '',
    ].join('\n'),
  };
}

/* Resolves true when Resend took the email, false otherwise. `what`
   names the email in the log and keeps the two idempotency keys apart. */
async function send(recordId, what, message) {
  if (!RESEND_KEY) {
    console.warn(`[apply] RESEND_API_KEY not set, no ${what} email sent for ${recordId}`);
    return false;
  }
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `application-${what}-${recordId}`,
      },
      body: JSON.stringify(message),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const why = (await res.text().catch(() => '')).slice(0, 300);
      console.error(`[apply] saved ${recordId} but the ${what} email was refused (${res.status}): ${why}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[apply] saved ${recordId} but the ${what} email did not send:`, e && e.message);
    return false;
  }
}

/* Both emails for one saved application. One after the other rather
   than together: Resend allows two requests a second across the whole
   account, and the Arena app sends on the same account. The office
   goes first, so a problem with the applicant's address never holds up
   the one the office is waiting on. */
async function sendApplicationEmails(recordId, a) {
  const office = await send(recordId, 'office', applicationEmail(a));
  const applicant = a.email ? await send(recordId, 'confirmation', confirmationEmail(a)) : false;
  return { office, applicant };
}

module.exports = { applicationEmail, confirmationEmail, sendApplicationEmails };
