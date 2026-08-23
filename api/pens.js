'use strict';

/* GET /api/pens
   Map pins for the facility map. Reads the boarding base and returns
   only the whitelisted fields below, keyed by Airtable field ID so the
   page can keep reading f[F.lat] exactly as it did before.

   Returns { configured: false } when no token is set, which tells the
   page to fall back to SAMPLE_RECORDS. */

const {
  BOARDING_BASE, airtableRequest, sendError, methodGuard,
} = require('./_airtable');

const TABLE = process.env.AIRTABLE_PENS_TABLE || 'Stalls, Traps, Pastures';

/* Field IDs, moved here from the page. Nothing outside this list is
   ever returned to the browser. */
const FIELDS = [
  'fldROk5FxumDucS4x', // name
  'fldDt32wGukq0j3y1', // status
  'fldxHkJhzrktSeWd0', // type
  'fld6JMW3CJKABOG1S', // cover
  'fldFRDFwRWHPwhxRV', // monthlyPrice
  'fld1nJ9GyMx1UXq1t', // nightlyPrice
  'fldsyjsIRNrW15859', // lat
  'fldeUBOGJqypS2DSw', // lng
  'fld2MLCJuDJXtudhr', // capacity
  'fldahzHLgsw0u3rT8', // availDate
  'fldwCfO6CVrIWVGqy', // description
  'fldkAlxdFei47ZekH', // photo
];

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;

  try {
    const query = new URLSearchParams();
    FIELDS.forEach((id) => query.append('fields[]', id));
    /* Selecting by field ID does not make Airtable answer by field ID:
       without this the response comes back keyed by column name and the
       page, which reads f[F.lat], finds nothing. */
    query.set('returnFieldsByFieldId', 'true');

    /* Page through in case the table grows past one page of 100. */
    const records = [];
    let offset;
    do {
      if (offset) query.set('offset', offset);
      const data = await airtableRequest(BOARDING_BASE, TABLE, { query });
      (data.records || []).forEach((r) => records.push({ id: r.id, fields: r.fields || {} }));
      offset = data.offset;
    } while (offset && records.length < 1000);

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    return res.status(200).json({ configured: true, records });
  } catch (err) {
    return sendError(res, err);
  }
};
