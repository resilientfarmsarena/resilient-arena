'use strict';

/* POST /api/resume-upload
   Hands the browser a short-lived presigned PUT URL so the resume goes
   straight from the applicant's device to Vercel Blob.

   Why presigned rather than the usual client-upload helper: the hiring
   page is a single static HTML file with no bundler, so it cannot import
   @vercel/blob/client. presignUrl gives a plain URL the page can PUT to
   with fetch and nothing else.

   Why direct at all: a Vercel Function request body is capped at 4.5 MB,
   and base64 inflates a file by about a third, so routing a 4 MB resume
   through the function would fail. Going straight to Blob removes that
   ceiling, which is what makes the advertised 4 MB limit honest.

   The presigned URL carries its own constraints. Content type and size
   are embedded in the token and enforced by Blob itself, so a caller
   cannot use this URL to upload something else or something bigger. */

const { issueSignedToken, presignUrl } = require('@vercel/blob');
const { methodGuard, readJsonBody, str } = require('./_airtable');

/* Keep in step with MAX_FILE_BYTES on the hiring page. The page checks
   this so it can show a friendly message; Blob enforces it for real. */
const MAX_BYTES = Number(process.env.RESUME_MAX_BYTES || 4 * 1024 * 1024);

/* Matches the file input's accept list on the page. */
const ALLOWED = {
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/heic': 'heic',
};

/* 'private' keeps resumes off publicly guessable URLs. Must match how the
   Blob store was created in the dashboard. */
const ACCESS = process.env.BLOB_ACCESS === 'public' ? 'public' : 'private';

const UPLOAD_WINDOW_MS = 10 * 60 * 1000;

function safeName(name) {
  const base = String(name).split(/[\\/]/).pop() || 'resume';
  return base
    .normalize('NFKD')
    .replace(/[^\w.\- ]+/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(-80) || 'resume';
}

function randomId() {
  return require('crypto').randomBytes(12).toString('hex');
}

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;

  if (!process.env.BLOB_READ_WRITE_TOKEN && !process.env.BLOB_STORE_ID) {
    /* No store wired up yet. The page treats this as "resume not
       available" and submits the application without one rather than
       blocking somebody from applying. */
    return res.status(200).json({ configured: false });
  }

  const b = readJsonBody(req);
  const filename    = safeName(str(b.filename, 200));
  const contentType = str(b.contentType, 100).toLowerCase();
  const size        = Number(b.size);

  if (!Object.prototype.hasOwnProperty.call(ALLOWED, contentType)) {
    return res.status(400).json({ error: 'Unsupported file type' });
  }
  if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
    return res.status(400).json({ error: 'File too large', maxBytes: MAX_BYTES });
  }

  /* Year prefix keeps the store browsable and gives the retention sweep
     something obvious to walk. */
  const year = new Date().getUTCFullYear();
  const pathname = `resumes/${year}/${randomId()}-${filename}`;

  try {
    const validUntil = Date.now() + UPLOAD_WINDOW_MS;

    const token = await issueSignedToken({
      pathname,
      operations: ['put'],
      allowedContentTypes: [contentType],
      maximumSizeInBytes: MAX_BYTES,
      validUntil,
    });

    const { presignedUrl } = await presignUrl(token, {
      operation: 'put',
      pathname,
      access: ACCESS,
      allowedContentTypes: [contentType],
      maximumSizeInBytes: MAX_BYTES,
      addRandomSuffix: false,
      allowOverwrite: false,
      validUntil,
    });

    /* The canonical blob URL is the presigned URL without its signature
       query. Derived here so the browser never has to invent a URL and
       /api/apply can check the one it gets back against this shape. */
    const u = new URL(presignedUrl);
    const blobUrl = `${u.origin}${u.pathname}`;

    return res.status(200).json({
      configured: true,
      uploadUrl: presignedUrl,
      blobUrl,
      pathname,
      contentType,
      maxBytes: MAX_BYTES,
    });
  } catch (err) {
    console.error('[resume-upload] could not presign:', err && err.message);
    return res.status(502).json({ error: 'Could not prepare the upload' });
  }
};
