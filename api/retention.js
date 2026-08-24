'use strict';

/* GET /api/retention
   Runs daily on a Vercel Cron.

   Resumes belonging to candidates who were not hired are cleared 12
   months after they applied. Arena Candidates is the only place a resume
   ever exists, so clearing the attachment there is what makes it
   genuinely gone. Hired candidates are left alone.

   Runs are idempotent. A record with an already-empty attachment is
   filtered out by the formula, so re-running changes nothing. */

const { HIRING_BASE, airtableRequest, isConfigured } = require('./_airtable');

const TABLE = process.env.AIRTABLE_CANDIDATES_TABLE || 'tbl1mKpAjKxyX47Wn';

/* filterByFormula addresses columns by name, not by field ID, so these
   are names. Writes still use the field ID where one is configured. */
const APPLIED_ON_NAME = process.env.AIRTABLE_APPLIED_ON_NAME || 'Applied On';
const STATUS_NAME     = process.env.AIRTABLE_STATUS_NAME     || 'Status';
const RESUME_NAME     = process.env.AIRTABLE_RESUME_NAME     || 'Resume';
const RESUME_FIELD    = process.env.AIRTABLE_RESUME_FIELD_ID || 'fld1euct1XuSwUas5';

const HIRED_STATUS  = process.env.AIRTABLE_HIRED_STATUS || 'Hired';
const RETAIN_MONTHS = Number(process.env.RESUME_RETENTION_MONTHS || 12);

function esc(v) { return String(v).replace(/'/g, "\\'"); }

async function sweepAirtable(report) {
  if (!isConfigured()) {
    report.airtable = { skipped: 'no airtable token configured' };
    return;
  }

  const formula = `AND(
    IS_BEFORE({${APPLIED_ON_NAME}}, DATEADD(TODAY(), -${RETAIN_MONTHS}, 'months')),
    {${STATUS_NAME}} != '${esc(HIRED_STATUS)}',
    LEN({${RESUME_NAME}} & '') > 0
  )`.replace(/\s+/g, ' ');

  const ids = [];
  let offset;
  do {
    const query = new URLSearchParams();
    query.set('filterByFormula', formula);
    query.append('fields[]', STATUS_NAME);
    if (offset) query.set('offset', offset);

    const data = await airtableRequest(HIRING_BASE, TABLE, { query });
    (data.records || []).forEach((r) => ids.push(r.id));
    offset = data.offset;
  } while (offset && ids.length < 5000);

  /* Airtable accepts 10 records per update request. */
  let cleared = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10).map((id) => ({ id, fields: { [RESUME_FIELD]: [] } }));
    await airtableRequest(HIRING_BASE, TABLE, { method: 'PATCH', body: { records: batch } });
    cleared += batch.length;
  }

  report.airtable = { cleared, retainMonths: RETAIN_MONTHS, keptStatus: HIRED_STATUS };
}

module.exports = async (req, res) => {
  /* Vercel Cron sends this header when CRON_SECRET is set on the project.
     Without the check the endpoint would be a public delete button. */
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  if (!secret) {
    console.warn('[retention] CRON_SECRET is not set, endpoint is unauthenticated');
  }

  const report = { ranAt: new Date().toISOString() };
  try {
    await sweepAirtable(report);
    console.log('[retention]', JSON.stringify(report));
    return res.status(200).json({ ok: true, ...report });
  } catch (err) {
    console.error('[retention] failed:', err && err.message, report);
    return res.status(500).json({ ok: false, error: 'Retention sweep failed', ...report });
  }
};
