'use strict';

/* POST /api/job-view   { job: "<link name>", first: true | false }

   A job page calls this once each time it is opened (assets/job-view.js)
   so the app can show how many people have looked at each job. It adds
   one to the job's Page Views in Airtable, and one to Visitors when the
   page says this browser has not opened the job before.

   Nothing about the person is kept: no address, no browser details. The
   visitor's address is used only for the speed limit below and never
   leaves this function's memory.

   Not counted:
     the team      any browser signed in through /team-login
     robots        search engines, link previews, monitors
     previews      a draft's ?preview= page never calls this at all
     closed jobs   and link names that match no job

   Answers 204 when the view was counted and 202 when it was not, with
   no body either way. The page uses the difference to decide whether to
   remember that this browser has been counted. */

const { methodGuard, readJsonBody } = require('./_airtable');
const { SLUG_RE, fetchJobs, findJob, addView } = require('./_jobs');

const TEAM_COOKIE = /(?:^|;\s*)ra_preview(?:_ui)?=/;
const ROBOT = /bot|crawl|spider|slurp|preview|headless|lighthouse|monitor|pingdom|facebookexternalhit|whatsapp|curl|wget|python|node-fetch|axios/i;

/* The jobs are looked up to turn a link name into a record. Held for a
   minute so a busy page does not read the whole table on every view. */
const JOBS_TTL_MS = 60 * 1000;
let jobsCache = { at: 0, jobs: [] };

async function jobFor(slug) {
  if (Date.now() - jobsCache.at > JOBS_TTL_MS) {
    jobsCache = { at: Date.now(), jobs: await fetchJobs() };
  }
  return findJob(jobsCache.jobs, slug);
}

/* In-memory speed limit, one function instance at a time. Enough to stop
   a stuck page or a bored visitor from running up a job's numbers or
   using up the Airtable request limit the app shares. */
const LIMIT = 20;
const WINDOW_MS = 60 * 1000;
const hits = new Map();

function underLimit(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= LIMIT) { hits.set(ip, list); return false; }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return true;
}

function done(res, counted) {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(counted ? 204 : 202).end();
}

module.exports = async (req, res) => {
  if (!methodGuard(req, res, 'POST')) return;

  const h = req.headers || {};
  if (TEAM_COOKIE.test(String(h.cookie || ''))) return done(res, false);
  if (!h['user-agent'] || ROBOT.test(String(h['user-agent']))) return done(res, false);
  /* Browsers say where a request came from. Only our own pages count. */
  if (h['sec-fetch-site'] && h['sec-fetch-site'] !== 'same-origin') return done(res, false);

  const ip = String(h['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (!underLimit(ip)) return done(res, false);

  const body = readJsonBody(req);
  const slug = String(body.job || '').trim().toLowerCase();
  if (!SLUG_RE.test(slug) || slug.length > 60) return done(res, false);

  try {
    const job = await jobFor(slug);
    if (!job || job.status === 'Closed') return done(res, false);
    return done(res, await addView(job.id, body.first === true));
  } catch (err) {
    /* A view that could not be counted is not worth an error on the
       visitor's side. Log it and move on. */
    console.error('[job-view]', err && err.message);
    return done(res, false);
  }
};
