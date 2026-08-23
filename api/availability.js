'use strict';

/* GET /api/availability
   Powers the "Available Pens" figure in the stats strip.
   Returns { configured, count }. The page shows "-" when not configured
   and "Full" when the count is zero, exactly as before. */

const {
  BOARDING_BASE, airtableRequest, sendError, methodGuard,
} = require('./_airtable');

const TABLE        = process.env.AIRTABLE_AVAIL_TABLE || 'Stalls, Traps, Pastures';
const STATUS_FIELD = 'Status';
const STATUS_VALUE = 'Available';

/* Escape single quotes so a value cannot break out of the formula. */
function formula(field, value) {
  const safe = String(value).replace(/'/g, "\\'");
  return `{${field}}='${safe}'`;
}

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;

  try {
    let count = 0;
    let offset;
    do {
      const query = new URLSearchParams();
      query.set('filterByFormula', formula(STATUS_FIELD, STATUS_VALUE));
      query.append('fields[]', STATUS_FIELD);
      if (offset) query.set('offset', offset);

      const data = await airtableRequest(BOARDING_BASE, TABLE, { query });
      count += (data.records || []).length;
      offset = data.offset;
    } while (offset && count < 5000);

    res.setHeader('Cache-Control', 's-maxage=30, stale-while-revalidate=120');
    return res.status(200).json({ configured: true, count });
  } catch (err) {
    return sendError(res, err);
  }
};
