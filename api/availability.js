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

/* The Public checkbox on the pens table, whose own description is "this
   is to show which pins are shown publicly on the website". A pen that
   is open but not meant to be advertised, one being held back or not
   finished, should not be counted in the figure visitors read. The map
   filters on the same field, so the number and the green pins agree. */
const PUBLIC_FIELD = 'Public';

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
      query.set('filterByFormula', `AND(${formula(STATUS_FIELD, STATUS_VALUE)}, {${PUBLIC_FIELD}})`);
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
