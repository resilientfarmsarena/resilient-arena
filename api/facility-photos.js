'use strict';

/* GET /api/facility-photos
   Optional photo overrides for the hero banner and the four service
   cards, read from Vercel Blob.

   HOW TO SWAP A PHOTO. Upload a file to the Blob store under the site/
   prefix, named after the slot it fills. The name is what matters, the
   extension does not:

     site/hero.jpg       the hero banner
     site/pastures.jpg   Pastures card
     site/stalls.jpg     Stalls card
     site/traps.jpg      Traps card
     site/arena.jpg      Arena card

   Upload a new file over the same name and the site picks it up on the
   next page load. No code change and no deploy.

   Anything not uploaded falls back to the image bundled in assets/, so
   the page is complete whether the store is empty, full, or absent.

   Works with a public or a private store. A public store serves its URL
   directly; a private one gets a short lived signed URL minted per
   request, so photos are never on a permanent public link if the store
   was created private. */

const { list, issueSignedToken, presignUrl } = require('@vercel/blob');
const { methodGuard } = require('./_airtable');

const PREFIX = 'site/';

/* Filename stem to the slot name the page looks for. */
const SLOTS = {
  hero:     'Hero Banner',
  pastures: 'Pastures',
  stalls:   'Stalls',
  traps:    'Traps',
  arena:    'Arena',
};

const ACCESS = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';
const SIGNED_WINDOW_MS = 6 * 60 * 60 * 1000;

function slotFor(pathname) {
  const file = pathname.slice(PREFIX.length);
  const stem = file.replace(/\.[^.]+$/, '').toLowerCase();
  return SLOTS[stem] || null;
}

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'GET')) return;

  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    /* No store yet. The page keeps the images bundled in assets/. */
    return res.status(200).json({ configured: false, photos: [] });
  }

  try {
    const found = new Map();
    let cursor;
    do {
      const page = await list({ prefix: PREFIX, cursor, limit: 1000 });
      for (const b of page.blobs || []) {
        const slot = slotFor(b.pathname);
        if (!slot) continue;
        /* Newest upload wins if a slot somehow has more than one file. */
        const prev = found.get(slot);
        if (!prev || new Date(b.uploadedAt) > new Date(prev.uploadedAt)) found.set(slot, b);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);

    const photos = [];
    for (const [location, blob] of found) {
      let url = blob.url;
      if (ACCESS === 'private') {
        const pathname = blob.pathname;
        const validUntil = Date.now() + SIGNED_WINDOW_MS;
        const token = await issueSignedToken({ pathname, operations: ['get'], validUntil });
        ({ presignedUrl: url } = await presignUrl(token, {
          operation: 'get', pathname, access: 'private', validUntil,
        }));
      }
      photos.push({ location, url });
    }

    /* Short cache: a signed URL must not outlive its signature, and a new
       upload should appear without a long wait. */
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ configured: true, photos });
  } catch (err) {
    /* Purely an enhancement. Never break the page over it. */
    console.error('[facility-photos] could not read blob store:', err && err.message);
    return res.status(200).json({ configured: true, photos: [] });
  }
};
