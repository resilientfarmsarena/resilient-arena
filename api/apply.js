'use strict';

/* POST /api/apply
   Writes one row to the "Arena Candidates" table in the hiring base.

   The hiring page already posted to this path whenever no token was set
   in the browser. That is now the only path: the page sends the plain
   answers and this function maps them onto Airtable field IDs.

   Field IDs live here rather than in the page, so renaming a column in
   Airtable still will not break the form, and the mapping is no longer
   something a visitor can see or change. */

const { issueSignedToken, presignUrl } = require('@vercel/blob');
const {
  HIRING_BASE, airtableRequest, sendError, methodGuard, readJsonBody, str,
} = require('./_airtable');

/* Attachment field on Arena Candidates. It does not exist yet: create it
   in Airtable, then put its field ID here via the environment. Without
   it the application still saves, just with no resume attached. */
const RESUME_FIELD = process.env.AIRTABLE_RESUME_FIELD_ID || '';

const ACCESS = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';

/* How long Airtable has to come and fetch the file. It normally pulls it
   within seconds; a day is slack, not an expectation. */
const FETCH_WINDOW_MS = 24 * 60 * 60 * 1000;

/* Only a URL this site just handed out is acceptable. Without this check
   a crafted request could point the attachment field at any URL and make
   Airtable fetch it. */
function isOurBlobUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return false; }
  if (u.protocol !== 'https:') return false;
  if (!/(^|\.)blob\.vercel-storage\.com$/.test(u.hostname)) return false;
  return u.pathname.startsWith('/resumes/');
}

/* Private blobs are not readable without a signature, so mint a
   short-lived GET URL for Airtable to ingest through. Airtable keeps its
   own copy, so the link expiring afterwards is the point. */
async function ingestUrlFor(blobUrl) {
  if (ACCESS === 'public') return blobUrl;
  const pathname = new URL(blobUrl).pathname.replace(/^\//, '');
  const validUntil = Date.now() + FETCH_WINDOW_MS;
  const token = await issueSignedToken({ pathname, operations: ['get'], validUntil });
  const { presignedUrl } = await presignUrl(token, {
    operation: 'get', pathname, access: 'private', validUntil,
  });
  return presignedUrl;
}

const TABLE = process.env.AIRTABLE_CANDIDATES_TABLE || 'tbl1mKpAjKxyX47Wn';

const F = {
  applicant:    'fldydNCJj7O42F5lf',
  status:       'fld9HOpaunfqIv4j5',
  appliedOn:    'fldiil3Lye5v2kWXf',
  firstName:    'fld4jRzASzERTA7mO',
  lastName:     'fldKMg6R8vepkA7GB',
  phone:        'fldBJBvK0DNTyEc4r',
  okToText:     'fldZfRBZZAMXNjx8o',
  email:        'fldCT7L7lWbuOdq5M',
  city:         'fldg9hCSgfvJD3k2y',
  positions:    'fld6YD4TIMXBzQjRF',
  desiredHours: 'fldDtokcp7RxSnIcy',
  roleFit:      'fldvhO5t0sloPUA5k',
  availability: 'fldO25ySGwLL9gheR',
  startDate:    'flduRyhbWYIz9RheQ',
  groundsSkills:'fldkQyk9iNvHq7zkq',
  otherSkills:  'fldS8Bbseh6fPI1YO',
  horseSkills:  'fldT8hdeZavLD9bDc',
  equipment:    'fldz1XdRDpAL3No1E',
  otherEquip:   'fldYl0Z9MuicO155a',
  applicator:   'fld94eiCluCncAyPj',
  horseExp:     'fld65wBTVGamUEFij',
  horseYears:   'fldh8iHvAvPAflydL',
  license:      'fldM65pkURm8N7u9I',
  transport:    'fld6yltiNFJAQycwU',
  workAuth:     'fldBFxVUQBbJc5Qnd',
  workHistory:  'fldSX0yr0Ytvd6y05',
  whyUs:        'fldKabCw5gxvKdVhI',
  rate:         'fldsWSc7qiVIYIaje',
  heardFrom:    'fldaFrohjbedTbM5d',
  source:       'fldtCSdO5p9LwlSLE',
};

/* Chip answers must match the Airtable select options. typecast is on,
   so an unknown option is created rather than dropped. Cap the list
   length and the individual values so a crafted request cannot spray
   junk options into the base. */
function strList(v, maxItems = 20, maxLen = 120) {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => str(x, maxLen))
    .filter(Boolean)
    .slice(0, maxItems);
}

function bool(v) { return v === true || v === 'true'; }

function isEmail(v) { return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v); }

function isDate(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v); }

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;

  const p = readJsonBody(req);

  const firstName = str(p.firstName, 80);
  const lastName  = str(p.lastName, 80);
  const phone     = str(p.phone, 40);
  const city      = str(p.city, 120);
  const email     = str(p.email, 160);

  /* Mirror of the page's own required list, re-checked here because
     client side validation is a convenience, not a guarantee. */
  const missing = [];
  if (!firstName) missing.push('firstName');
  if (!lastName) missing.push('lastName');
  if (phone.replace(/\D/g, '').length < 10) missing.push('phone');
  if (!city) missing.push('city');
  if (!str(p.workHistory, 5000)) missing.push('workHistory');
  if (email && !isEmail(email)) missing.push('email');
  if (missing.length) {
    return res.status(400).json({ error: 'Incomplete application', fields: missing });
  }

  const fields = {};
  fields[F.applicant]    = `${firstName} ${lastName}`;
  fields[F.status]       = 'New';
  fields[F.source]       = 'Hiring Page Form';
  fields[F.appliedOn]    = new Date().toISOString();
  fields[F.firstName]    = firstName;
  fields[F.lastName]     = lastName;
  fields[F.phone]        = phone;
  fields[F.okToText]     = bool(p.okToText);
  if (email) fields[F.email] = email;
  fields[F.city]         = city;
  fields[F.positions]    = strList(p.positionInterest);
  fields[F.desiredHours] = str(p.desiredHours, 120);
  fields[F.roleFit]      = str(p.roleFit, 120);
  fields[F.availability] = strList(p.availability, 7);
  if (isDate(str(p.startDate, 10))) fields[F.startDate] = str(p.startDate, 10);
  fields[F.groundsSkills] = strList(p.groundsSkills);
  if (str(p.otherSkills, 2000)) fields[F.otherSkills] = str(p.otherSkills, 2000);
  fields[F.horseSkills]  = strList(p.horseSkills);
  fields[F.equipment]    = strList(p.equipment);
  if (str(p.otherEquipment, 2000)) fields[F.otherEquip] = str(p.otherEquipment, 2000);
  if (str(p.applicator, 120)) fields[F.applicator] = str(p.applicator, 120);
  fields[F.horseExp]     = str(p.horseExperience, 200);

  const years = Number(p.horseYears);
  if (p.horseYears !== '' && p.horseYears !== undefined && Number.isFinite(years) && years >= 0 && years < 100) {
    fields[F.horseYears] = years;
  }

  fields[F.license]     = bool(p.license);
  fields[F.transport]   = bool(p.transportation);
  fields[F.workAuth]    = bool(p.workAuth);
  fields[F.workHistory] = str(p.workHistory, 5000);
  if (str(p.whyUs, 5000)) fields[F.whyUs] = str(p.whyUs, 5000);
  if (str(p.rate, 120)) fields[F.rate] = str(p.rate, 120);
  if (str(p.heardFrom, 200)) fields[F.heardFrom] = str(p.heardFrom, 200);

  /* Resume. The browser has already put the file in Blob and sends back
     only the URL, so nothing large passes through this function. */
  let resumeStored = false;
  const resumeUrl  = str(p.resumeUrl, 500);
  const resumeName = str(p.resumeName, 200) || 'resume';

  if (resumeUrl) {
    if (!isOurBlobUrl(resumeUrl)) {
      return res.status(400).json({ error: 'Invalid resume reference' });
    }
    if (!RESUME_FIELD) {
      console.warn('[apply] AIRTABLE_RESUME_FIELD_ID not set, resume uploaded but not attached:', resumeUrl);
    } else {
      try {
        fields[RESUME_FIELD] = [{ url: await ingestUrlFor(resumeUrl), filename: resumeName }];
        resumeStored = true;
      } catch (e) {
        /* An application is worth more than its attachment. Log and carry
           on rather than losing the whole submission. */
        console.error('[apply] could not attach resume:', e && e.message);
      }
    }
  }

  try {
    const data = await airtableRequest(HIRING_BASE, TABLE, {
      method: 'POST',
      body: { records: [{ fields }], typecast: true },
    });
    const id = data.records && data.records[0] && data.records[0].id;
    return res.status(201).json({ ok: true, id, resumeStored });
  } catch (err) {
    if (err && err.code === 'NOT_CONFIGURED') {
      /* No token set. The form behaves as it always did with an empty
         token: it reports success without saving. */
      console.warn('[apply] AIRTABLE_TOKEN not set, application not saved');
      return res.status(200).json({ ok: true, stored: false });
    }
    return sendError(res, err);
  }
};
