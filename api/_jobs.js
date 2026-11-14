'use strict';

/* ==================================================================
   The Jobs table in the hiring base, as the public hiring pages read it.

   One row is one job. The Resilient Arena app writes the rows, a person
   can also edit them straight in Airtable, and this module is the only
   place on the website that knows the table's shape. Nothing outside
   the whitelist below is ever requested, so Internal Notes and the
   applicant links cannot reach a page by accident.

   Filename starts with an underscore so Vercel treats it as a plain
   module and not as a routable endpoint.
   ================================================================== */

const { HIRING_BASE, airtableRequest } = require('./_airtable');

const TABLE = process.env.AIRTABLE_JOBS_TABLE || 'tblgINFG3fTEMw8B1';

const F = {
  title:        'fldZgO075Voxbu9xk',
  status:       'fldbOb3qEQkv37tZ4',
  slug:         'fldnnuIHfiGKi67Lf', // "Web Address Name"
  order:        'fldZfwowWA9rC7nVe',
  type:         'fldrPHtU80Mk5PNrN',
  location:     'fld2pyjzn1HQs0FL9',
  photo:        'fld9R9FBDbegGOx5i',
  summary:      'fldgvrnTXyOWz8GXs',
  schedule:     'fld6uCuhIZZ9AhRXb',
  pay:          'fldbxNFhy7HLulzGK',
  taxForm:      'fldpSadF0fdDYGBCu', // "W-2 or 1099"
  need:         'fldsj51PZUhLHA1dV',
  future:       'fldfGqv55Gh9f4RpN', // "Where It Can Go"
  intro:        'fld8KL16eAgxzl4Zz',
  oppHeading:   'fldASewfU3gdgumgM',
  oppIntro:     'fldAvz5BAtGqv7fBv',
  steps:        'fldGS6LRp1Q7SRKA7',
  oppClosing:   'fldgb4rQ3kwygV12F',
  bigNumber:    'fld5WuhfI4bgjZfpA',
  bigLabel:     'fldptCudBlinDq4Rt',
  bigText:      'flduYgArcwV5KU8Nu',
  dutiesHeading:'fldYkBsJF2J0VvOuA',
  dutiesIntro:  'fldzf8mtJbitM64mA',
  duties:       'fldPwmshR5A97NEG2',
  dutiesNote:   'fld5hOFyYlwepUAdS',
  promisesHeading: 'fldvDUN2MypCmpMu7',
  promises:     'fldMw3kuXZcGldAjx',
  fitHeading:   'fldNyjm0vNR2kG9pM',
  fit:          'fldIbgi84sZvvXfCp',
  fitClosing:   'fldZWEVTEXFbE2UJb',
  /* Read only for the search engine job listing data, which has to
     carry a posting date. Never printed on a page. */
  datePosted:   'flduh6jP3WXHsCVHG',
};

/* What a job's link may end in. The Address Check formula in Airtable
   holds people to the same pattern. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const EM = String.fromCharCode(0x2014);
const EM_RE = new RegExp('\\s*' + EM + '\\s*', 'g');

/* One clean string. The site rule against em dashes is applied here as
   well as in the app, because a job can also be typed into Airtable by
   hand and the rule should not depend on who did the typing. */
function text(v) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/\r\n?/g, '\n').replace(EM_RE, ' - ').trim();
}

/* A paragraph field. Every line break starts a new paragraph, so it
   reads right whether the writer left a blank line between them or
   only pressed Enter once. */
function paragraphs(v) {
  return text(v).split(/\n+/).map((s) => s.trim()).filter(Boolean);
}

/* A list field: Duties, Promises, Fit List. Items are separated by a
   blank line. Inside an item the first line is the heading and the
   rest is the detail. */
function items(v) {
  return text(v).split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n').map((s) => s.trim()).filter(Boolean);
    return { heading: lines[0] || '', detail: lines.slice(1).join(' ') };
  }).filter((it) => it.heading);
}

/* Growth Steps carries one more line at the top of each item, the
   timing, such as "Right now". A step typed with only two lines is
   taken as a heading and its detail rather than dropped. */
function steps(v) {
  return text(v).split(/\n\s*\n/).map((block) => {
    const lines = block.split('\n').map((s) => s.trim()).filter(Boolean);
    if (lines.length >= 3) {
      return { when: lines[0], heading: lines[1], detail: lines.slice(2).join(' ') };
    }
    return { when: '', heading: lines[0] || '', detail: lines.slice(1).join(' ') };
  }).filter((it) => it.heading);
}

/* First attachment only. Airtable's file links expire after a couple of
   hours, which is fine here because the pages are rebuilt far more
   often than that. The large thumbnail is what the list card shows: a
   photo straight off a phone would be several megabytes. */
function photo(v) {
  const a = Array.isArray(v) ? v[0] : null;
  if (!a || !a.url || !/^image\//i.test(a.type || '')) return null;
  const large = a.thumbnails && a.thumbnails.large;
  return { url: (large && large.url) || a.url };
}

function shape(record) {
  const f = record.fields || {};
  const order = Number(f[F.order]);
  return {
    id: record.id,
    created: record.createdTime || '',
    title: text(f[F.title]),
    status: text(f[F.status]),
    slug: text(f[F.slug]).toLowerCase(),
    order: Number.isFinite(order) ? order : Number.MAX_SAFE_INTEGER,
    type: text(f[F.type]),
    location: text(f[F.location]),
    photo: photo(f[F.photo]),
    summary: paragraphs(f[F.summary]).join(' '),
    schedule: text(f[F.schedule]),
    pay: text(f[F.pay]),
    taxForm: text(f[F.taxForm]),
    need: text(f[F.need]),
    future: text(f[F.future]),
    intro: paragraphs(f[F.intro]),
    oppHeading: text(f[F.oppHeading]),
    oppIntro: paragraphs(f[F.oppIntro]),
    steps: steps(f[F.steps]),
    oppClosing: paragraphs(f[F.oppClosing]),
    bigNumber: text(f[F.bigNumber]),
    bigLabel: text(f[F.bigLabel]),
    bigText: paragraphs(f[F.bigText]),
    dutiesHeading: text(f[F.dutiesHeading]),
    dutiesIntro: paragraphs(f[F.dutiesIntro]),
    duties: items(f[F.duties]),
    dutiesNote: paragraphs(f[F.dutiesNote]),
    promisesHeading: text(f[F.promisesHeading]),
    promises: items(f[F.promises]),
    fitHeading: text(f[F.fitHeading]),
    fit: items(f[F.fit]),
    fitClosing: paragraphs(f[F.fitClosing]),
    datePosted: text(f[F.datePosted]),
  };
}

/* Every job in the table, whatever its status. The table is a handful
   of rows, so it is read whole and filtered here rather than with a
   formula, which would address the columns by name and break the day
   someone renames one. */
async function fetchJobs() {
  const query = new URLSearchParams();
  Object.values(F).forEach((id) => query.append('fields[]', id));
  query.set('returnFieldsByFieldId', 'true');

  const jobs = [];
  let offset;
  do {
    if (offset) query.set('offset', offset);
    const data = await airtableRequest(HIRING_BASE, TABLE, { query });
    (data.records || []).forEach((r) => jobs.push(shape(r)));
    offset = data.offset;
  } while (offset && jobs.length < 500);

  return jobs.filter((j) => j.title);
}

/* The public list: open jobs with a usable link, in List Order. */
function openJobs(jobs) {
  return jobs
    .filter((j) => j.status === 'Open' && SLUG_RE.test(j.slug))
    .sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
}

/* One job by its link name. If two rows were ever given the same name,
   the open one wins, then the closed one, so a stray draft can never
   hide a job that is posted. */
function findJob(jobs, slug) {
  const rank = { Open: 0, Closed: 1 };
  return jobs
    .filter((j) => j.slug === slug)
    .sort((a, b) => (rank[a.status] ?? 2) - (rank[b.status] ?? 2))[0] || null;
}

module.exports = { SLUG_RE, fetchJobs, openJobs, findJob };
