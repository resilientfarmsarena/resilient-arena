'use strict';

/* GET /hiring           every open job
   GET /hiring/<name>    one job and its application form

   Both addresses are rewritten to this function in vercel.json, with
   the job's link name arriving as ?job=. The pages are written here on
   the server rather than filled in by script in the browser, so that a
   link pasted into a text or a Facebook post shows the job's own title,
   a search engine can read the job, and a job that is gone answers
   with a real "gone" instead of an empty shell.

   What each status gets:
     Open     the full page                                   200
     Closed   "this position has been filled"                 410
     Draft    not found, unless the link carries the job's
              own record ID as ?preview=, which is how a job
              is looked over before it is posted              404 / 200
     no such  not found                                       404

   Pages are cached at the edge for half a minute, so a change made in
   Airtable or in the app shows publicly within about a minute. */

const { SLUG_RE, fetchJobs, openJobs, findJob } = require('./_jobs');
const pages = require('./_hiring-html');

const CACHE = 'public, max-age=0, s-maxage=30, stale-while-revalidate=30';

function send(res, status, html, cache) {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  return res.status(status).send(html);
}

function one(v) {
  return String(Array.isArray(v) ? v[0] : v || '');
}

module.exports = async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  let jobs;
  try {
    jobs = await fetchJobs();
  } catch (err) {
    /* Airtable is down or the token is missing. Say so plainly, give
       the phone number, and do not let the edge hold on to it. */
    console.error('[hiring]', err && err.message);
    return send(res, 503, pages.troublePage(), 'no-store');
  }

  const slug = one(req.query && req.query.job).trim().toLowerCase();
  if (!slug) return send(res, 200, pages.listPage(openJobs(jobs)), CACHE);

  const job = SLUG_RE.test(slug) ? findJob(jobs, slug) : null;
  if (!job) return send(res, 404, pages.notFoundPage(), CACHE);

  if (job.status === 'Open') return send(res, 200, pages.jobPage(job), CACHE);
  if (job.status === 'Closed') return send(res, 410, pages.closedPage(job), CACHE);

  /* A draft. Its record ID is long, random, and printed on no public
     page, so it serves as the key to a private look at the job. */
  if (one(req.query.preview) === job.id) {
    return send(res, 200, pages.jobPage(job, { preview: true }), 'no-store');
  }
  return send(res, 404, pages.notFoundPage(), CACHE);
};
