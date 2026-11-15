/* Counts a visit to a job page, so the app can show how many people
   have looked at each job.

   It sends two things to /api/job-view: the job's link name, and whether
   this browser has opened the job before. Nothing about the person. The
   "opened before" note is kept in this browser only.

   The team is left out: a browser signed in through /team-login carries
   the marker checked here, and the server checks again. */
(function () {
  "use strict";

  var me = document.currentScript;
  var job = me && me.getAttribute("data-job");
  if (!job || !window.fetch || navigator.webdriver) return;
  if (/(?:^|;\s*)ra_preview_ui=1(?:;|$)/.test(document.cookie)) return;

  var KEY = "ra_seen_job_" + job;
  var first = true;
  try { first = !window.localStorage.getItem(KEY); } catch (e) {}

  fetch("/api/job-view", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ job: job, first: first }),
    credentials: "same-origin",
    keepalive: true
  }).then(function (res) {
    /* 204 means counted. Only then is this browser marked as seen, so a
       visit that was not counted does not use up the person's first. */
    if (res.status !== 204) return;
    try { window.localStorage.setItem(KEY, "1"); } catch (e) {}
  }).catch(function () {});
})();
