'use strict';

/* GET /api/facility-photos
   Optional Airtable-driven overrides for the hero banner and the
   service card photos. When this returns nothing the page keeps the
   files in assets/, which is the normal case today.

   Returns { configured, photos: [{ location, url }] } rather than the
   raw attachment objects, so only the image URL crosses the wire. */

const {
  BOARDING_BASE, airtableRequest, sendError, methodGuard,
} = require('./_airtable');

const TABLE = process.env.AIRTABLE_PHOTOS_TABLE || 'Facility Photos';

/* Only these slots exist on the page. Anything else is ignored. */
const ALLOWED_LOCATIONS = new Set([
  'Hero Banner', 'Pastures', 'Stalls', 'Traps', 'Arena',
]);

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;

  try {
    const query = new URLSearchParams();
    query.append('fields[]', 'Location');
    query.append('fields[]', 'Location Photo');

    const data = await airtableRequest(BOARDING_BASE, TABLE, { query });

    const photos = [];
    (data.records || []).forEach((r) => {
      const f = r.fields || {};
      const location = f['Location'];
      const attachments = f['Location Photo'];
      if (!ALLOWED_LOCATIONS.has(location)) return;
      if (!Array.isArray(attachments) || !attachments.length) return;
      const url = attachments[0] && attachments[0].url;
      if (typeof url !== 'string' || !url.startsWith('https://')) return;
      photos.push({ location, url });
    });

    /* Airtable attachment URLs are signed and short lived, so do not let
       a CDN hold them longer than they stay valid. */
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ configured: true, photos });
  } catch (err) {
    return sendError(res, err);
  }
};
