'use strict';

/* POST /api/apply
   Writes one row to the "Arena Candidates" table in the hiring base.

   The hiring page already posted to this path whenever no token was set
   in the browser. That is now the only path: the page sends the plain
   answers and this function maps them onto Airtable field IDs.

   Field IDs live here rather than in the page, so renaming a column in
   Airtable still will not break the form, and the mapping is no longer
   something a visitor can see or change. */

const {
  HIRING_BASE, airtableRequest, airtableUploadAttachment,
  sendError, methodGuard, readJsonBody, str,
} = require('./_airtable');

/* The Resume attachment field on Arena Candidates, in the hiring base.
   Airtable fetches the file from the URL below and keeps its own copy on
   the candidate's row, which is where the resume actually lives. Blob is
   only the way the file gets off the applicant's device. */
const RESUME_FIELD = process.env.AIRTABLE_RESUME_FIELD_ID || 'fld1euct1XuSwUas5';

/* Ceiling on the resume. Airtable's direct upload route allows 5 MB of
   base64, but a Vercel function body is capped at 4.5 MB and base64 adds
   about a third, so ours is the binding limit. 3 MB of file becomes 4 MB
   of base64, which leaves room for the answers alongside it. Keep this in
   step with MAX_FILE_BYTES on the hiring page. */
const RESUME_MAX_BYTES = Number(process.env.RESUME_MAX_BYTES || 3 * 1024 * 1024);

/* Matches the file input's accept list on the page. */
const ALLOWED_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg', 'image/png', 'image/heic',
]);

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

  /* Resume. Sent as base64 and pushed straight into the attachment cell
     on this candidate's row, so the file only ever exists in Airtable.
     Validated here before anything is written. */
  const resume = p.resume && typeof p.resume === 'object' ? p.resume : null;
  let resumeB64 = null;
  let resumeName = 'resume';
  let resumeType = 'application/octet-stream';

  if (resume) {
    resumeB64  = typeof resume.data === 'string' ? resume.data : '';
    resumeName = str(resume.filename, 200) || 'resume';
    resumeType = str(resume.contentType, 100).toLowerCase();

    if (!ALLOWED_TYPES.has(resumeType)) {
      return res.status(400).json({ error: 'Unsupported resume file type' });
    }
    /* base64 is 4 chars per 3 bytes, so measure the decoded size. */
    const bytes = Math.floor(resumeB64.length * 3 / 4);
    if (!bytes || bytes > RESUME_MAX_BYTES) {
      return res.status(400).json({ error: 'Resume is too large', maxBytes: RESUME_MAX_BYTES });
    }
  }

  try {
    const data = await airtableRequest(HIRING_BASE, TABLE, {
      method: 'POST',
      body: { records: [{ fields }], typecast: true },
    });
    const id = data.records && data.records[0] && data.records[0].id;

    /* Attach after the row exists, because the upload route needs a
       record to attach to. If it fails the application is already saved:
       log it and say so rather than losing the whole submission over a
       file. */
    let resumeStored = false;
    if (id && resumeB64) {
      try {
        await airtableUploadAttachment(HIRING_BASE, id, RESUME_FIELD, {
          filename: resumeName, contentType: resumeType, base64: resumeB64,
        });
        resumeStored = true;
      } catch (e) {
        console.error(`[apply] saved ${id} but could not attach the resume:`, e && e.message);
      }
    }

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
