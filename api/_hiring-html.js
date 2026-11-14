'use strict';

/* ==================================================================
   The HTML for the hiring pages. api/hiring.js decides which page a
   request gets; this file only knows how each one is written.

   Every value that came out of Airtable passes through esc() on its
   way into the page. A job is typed by a person, and a stray angle
   bracket in a job title must not be able to become markup.

   The look lives in /assets/hiring.css and the application form's
   behaviour in /assets/hiring-apply.js.
   ================================================================== */

const SITE = 'https://www.resilientarena.com';
const PHONE_SHOWN = '(325) 627-3726';
const PHONE_TEL = '+13256273726';
const SHARE_IMAGE = SITE + '/assets/hero-aerial.jpg';
const EMAIL = 'info@resilientarena.com';

/* The home page has been a "coming soon" page since 9 November 2026,
   with the full site held back in archive/. While that is so there is
   no contact form to send anyone to, so "Send us a note" opens an email
   instead. Set this to true the day the full home page returns and it
   goes back to the form.

   This switch does not touch the header or the footer. Those are the
   site's own, the same on every page, whatever the home page is doing. */
const HOME_IS_OPEN = false;

const NOTE_HREF = HOME_IS_OPEN
  ? '/#contact'
  : `mailto:${EMAIL}?subject=${encodeURIComponent('Work at Resilient Arena')}`;

function esc(v) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const paras = (list, cls) =>
  list.map((t) => `<p${cls ? ` class="${cls}"` : ''}>${esc(t)}</p>`).join('\n');

/* The last word of a heading is set in olive, the way "Request
   Boarding" is on the boarding page. */
function accent(title) {
  const words = title.split(/\s+/).filter(Boolean);
  if (words.length < 2) return esc(title);
  const last = words.pop();
  return `${esc(words.join(' '))} <em>${esc(last)}</em>`;
}

function clip(text, max) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 1);
  return cut.slice(0, Math.max(cut.lastIndexOf(' '), 40)).replace(/[\s.,;:]+$/, '') + '...';
}

/* ------------------------------------------------------------------
   The frame every page shares: head, the site header, the footer, and
   the small script that keeps the page clear of the fixed header.

   SITE RULE: the navigation menu and the footer are exactly the ones
   on the rest of the site, and every hiring page shows both, including
   the pages for a closed job, a missing job, and a list that will not
   load. Do not trim, reword or hide either one here. If the site's
   menu or footer changes, change these to match.
   ------------------------------------------------------------------ */
function layout({ title, description, canonical, index, shareTitle, jsonLd, body, scripts }) {
  const share = esc(shareTitle || title);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${canonical ? `<link rel="canonical" href="${esc(canonical)}">` : ''}
<meta name="robots" content="${index ? 'index,follow' : 'noindex,nofollow'}">
${canonical ? `<meta property="og:url" content="${esc(canonical)}">` : ''}
<meta property="og:type" content="website">
<meta property="og:title" content="${share}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SHARE_IMAGE}">
<meta property="og:site_name" content="Resilient Arena">
<meta name="twitter:card" content="summary_large_image">
${jsonLd ? `<script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>` : ''}
<link rel="icon" href="/assets/icons/favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/icons/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/assets/icons/favicon-16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/assets/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-title" content="Resilient Arena">
<link rel="manifest" href="/site.webmanifest">
<script src="/assets/preview-badge.js" defer></script>
<meta name="theme-color" content="#3A382E">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/assets/hiring.css">
</head>
<body>

<div class="site-header">
  <div class="topbar" id="topbar">
    <span style="font-weight:600;color:rgba(245,240,232,1);">Already a boarder?</span>
    <a class="topbar-btn" href="https://app.resilientarena.com" target="_blank" rel="noopener">Go to app</a>
    <button class="topbar-close" id="topbar-close" onclick="dismissTopbar()" aria-label="Close">&#10005;</button>
  </div>
  <nav>
    <a href="/" class="nav-logo">Resilient Arena</a>
    <ul class="nav-links">
      <li><a href="/#services">Services</a></li>
      <li><a href="/#availability">Boarding</a></li>
      <li><a href="/#reserve">Reserve Arena</a></li>
      <li><a href="/#contact" class="nav-cta">Inquire</a></li>
    </ul>
    <button class="nav-toggle" id="nav-toggle" onclick="toggleMenu()" aria-label="Menu" aria-expanded="false">
      <span></span><span></span><span></span>
    </button>
  </nav>
  <div class="mobile-menu" id="mobile-menu">
    <ul>
      <li><a href="/#services" onclick="closeMenu()">Services</a></li>
      <li><a href="/#availability" onclick="closeMenu()">Boarding</a></li>
      <li><a href="/#reserve" onclick="closeMenu()">Reserve Arena</a></li>
      <li><a href="/#contact" class="nav-cta" onclick="closeMenu()">Inquire</a></li>
    </ul>
  </div>
</div>

${body}

<footer>
  <div class="footer-logo">Resilient Arena</div>
  <p>&copy; <span id="copyright-year"></span> Resilient Arena LLC &middot; Abilene, Texas &middot;
     <a href="/privacy/">Privacy</a> &middot; <a href="/terms/">Terms</a></p>
</footer>

<script>
  function toggleMenu() {
    const menu = document.getElementById('mobile-menu');
    const btn = document.getElementById('nav-toggle');
    const open = menu.classList.toggle('open');
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  function closeMenu() {
    document.getElementById('mobile-menu').classList.remove('open');
    const btn = document.getElementById('nav-toggle');
    btn.classList.remove('open');
    btn.setAttribute('aria-expanded', 'false');
  }
  function dismissTopbar() {
    const bar = document.getElementById('topbar');
    if (bar) bar.remove();
    setHeaderHeight();
  }
  /* The header is fixed, so the page has to be pushed clear of it. */
  function setHeaderHeight() {
    const h = document.querySelector('.site-header').offsetHeight;
    document.documentElement.style.setProperty('--header-h', (h + 16) + 'px');
  }
  /* 100vw includes the scrollbar, which would push the centred content
     that much narrower than --page-max. Measured here and subtracted. */
  function setScrollbarWidth() {
    const w = window.innerWidth - document.documentElement.clientWidth;
    document.documentElement.style.setProperty('--sbw', Math.max(0, w) + 'px');
  }
  window.addEventListener('resize', setScrollbarWidth);
  setScrollbarWidth();
  window.addEventListener('resize', setHeaderHeight);
  setHeaderHeight();
  document.getElementById('copyright-year').textContent = new Date().getFullYear();
</script>
${scripts || ''}
</body>
</html>
`;
}

/* ------------------------------------------------------------------
   /hiring: every open job.
   ------------------------------------------------------------------ */
function jobCard(job) {
  const kicker = [job.type, job.location].filter(Boolean).map(esc).join(' &middot; ');
  const facts = [['Schedule', job.schedule], ['Pay', job.pay]].filter(([, v]) => v);
  return `<a class="job${job.photo ? '' : ' job--plain'}" href="/hiring/${esc(job.slug)}">
  ${job.photo ? `<div class="job-photo"><img src="${esc(job.photo.url)}" alt="" loading="lazy" decoding="async"></div>` : ''}
  <div class="job-main">
    ${kicker ? `<div class="job-kicker">${kicker}</div>` : ''}
    <h2 class="job-title">${esc(job.title)}</h2>
    ${job.summary ? `<p class="job-sum">${esc(job.summary)}</p>` : ''}
    ${facts.length ? `<dl class="job-facts">
      ${facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('\n      ')}
    </dl>` : ''}
    <span class="btn">See this job</span>
  </div>
</a>`;
}

function listPage(jobs) {
  const none = jobs.length === 0;
  const count = `${jobs.length} open position${jobs.length === 1 ? '' : 's'}`;

  const body = `<main>
  <section class="hero">
    <div class="hero-bg"></div>
    <div class="hero-in">
      <div class="tag">${none ? 'Abilene, Texas' : 'Now hiring &middot; Abilene, Texas'}</div>
      <h1>Work at <em>Resilient Arena</em></h1>
      <p class="lede">${none
        ? 'This is where we list every job we have open.'
        : 'Every job we have open is listed below. Tap one to see what the work is and how to apply. You do not need a resume.'}</p>
    </div>
  </section>

  <section class="body">
    <div class="cols${none ? ' is-empty' : ''}">
      <div>
        ${none ? `<div class="card empty">
          <h2>Nothing open right now</h2>
          <p>We are not hiring today, but we are a growing outfit. Tell us what kind of work you do and we will call you first when something opens.</p>
          <a class="btn" href="${NOTE_HREF}">Send us a note</a>
          <p class="empty-alt">Or call us at <a class="link" href="tel:${PHONE_TEL}">${PHONE_SHOWN}</a>.</p>
        </div>` : `<div class="count"><i></i><strong>${count}</strong></div>
        <div class="list">
${jobs.map(jobCard).join('\n')}
        </div>`}
      </div>
      ${none ? '' : `<aside class="side">
        <div class="card panel">
          <div class="step-label">How applying works</div>
          <ol class="steps">
            <li><div><b>Pick a job</b><span>Tap any job on this page to read what the work is.</span></div></li>
            <li><div><b>Answer a few questions</b><span>About five minutes, right on your phone. No resume needed.</span></div></li>
            <li><div><b>We get back to you</b><span>We read every application and answer within seven days.</span></div></li>
          </ol>
        </div>
        <div class="card panel panel--quiet">
          <h2>Do not see your kind of work?</h2>
          <p>We are growing. Tell us what you do and we will keep you in mind.</p>
          <a class="link" href="${NOTE_HREF}">Send us a note</a>
        </div>
      </aside>`}
    </div>
  </section>
</main>`;

  return layout({
    title: 'Jobs at Resilient Arena - Abilene, TX',
    description: none
      ? 'Jobs at Resilient Arena in Abilene, Texas. Nothing is open today. Send us a note and we will call you first when something opens.'
      : 'Open jobs at Resilient Arena in Abilene, Texas. See what the work is and apply in about five minutes. No resume needed.',
    canonical: SITE + '/hiring',
    index: true,
    shareTitle: none ? 'Jobs at Resilient Arena' : 'Now hiring at Resilient Arena - Abilene, TX',
    body,
  });
}

/* ------------------------------------------------------------------
   /hiring/<name>: one job, then its application form.
   ------------------------------------------------------------------ */
function sheet(tag, heading, inner) {
  return `<article class="card sheet">
  <div class="tag">${tag}</div>
  <h2>${esc(heading)}</h2>
  ${inner}
</article>`;
}

function jobSections(job) {
  const out = [];

  if (job.oppHeading || job.oppIntro.length || job.steps.length || job.oppClosing.length) {
    out.push(sheet('The opportunity', job.oppHeading || 'Where this can go', `${paras(job.oppIntro)}
  ${job.steps.length ? `<ol class="path">
    ${job.steps.map((s, i) => `<li><div class="n">${i + 1}</div><div>${s.when ? `<small>${esc(s.when)}</small>` : ''}<h3>${esc(s.heading)}</h3>${s.detail ? `<p>${esc(s.detail)}</p>` : ''}</div></li>`).join('\n    ')}
  </ol>` : ''}
  ${paras(job.oppClosing)}`));
  }

  if (job.bigNumber || job.bigText.length) {
    out.push(`<div class="bignum${job.bigNumber ? '' : ' bignum--solo'}">
  ${job.bigNumber ? `<div><div class="bignum-n">${esc(job.bigNumber)}</div>${job.bigLabel ? `<div class="bignum-l">${esc(job.bigLabel)}</div>` : ''}</div>` : ''}
  <div>${paras(job.bigText)}</div>
</div>`);
  }

  if (job.dutiesHeading || job.dutiesIntro.length || job.duties.length) {
    out.push(sheet('The job', job.dutiesHeading || 'What you would do', `${paras(job.dutiesIntro)}
  ${job.duties.length ? `<ul class="tasks">
    ${job.duties.map((d) => `<li><b>${esc(d.heading)}</b>${d.detail ? ' ' + esc(d.detail) : ''}</li>`).join('\n    ')}
  </ul>` : ''}
  ${paras(job.dutiesNote, 'fine')}`));
  }

  if (job.promises.length) {
    out.push(sheet('Why work here', job.promisesHeading || 'What we promise you', `<ul class="promises">
    ${job.promises.map((p) => `<li><h3>${esc(p.heading)}</h3>${p.detail ? `<p>${esc(p.detail)}</p>` : ''}</li>`).join('\n    ')}
  </ul>`));
  }

  if (job.fit.length || job.fitClosing.length) {
    out.push(sheet('Who we are looking for', job.fitHeading || 'You might be the one', `${job.fit.length ? `<ul class="fit">
    ${job.fit.map((f) => `<li><div><b>${esc(f.heading)}</b>${f.detail ? ' ' + esc(f.detail) : ''}</div></li>`).join('\n    ')}
  </ul>` : ''}
  ${paras(job.fitClosing)}`));
  }

  return out.join('\n\n');
}

const chip = (name, value, label, id) =>
  `<label><input type="checkbox"${id ? ` id="${id}"` : ''} name="${name}" value="${esc(value)}"><span>${esc(label || value)}</span></label>`;

/* The application. The questions and their notes are the same for every
   job today, and several are worded for the caretaker job: two days a
   week, grounds work, no horse experience needed. Revisit them before a
   different kind of job is posted. */
function applyForm(job) {
  const option = (v) => `<option>${esc(v)}</option>`;
  return `<article class="card sheet" id="apply">
  <div class="tag">Apply</div>
  <h2 data-apply-intro>Tell us about yourself</h2>
  <p data-apply-intro>Please answer the required questions, then anything else you want to share. It takes about five minutes. We answer every single one within seven days.</p>

  <form id="applyForm" data-job="${esc(job.slug)}" novalidate>

    <div class="form-group">
      <div class="step-label">How we reach you</div>
      <div class="form-grid">
        <div class="f">
          <label for="firstName">First name <span class="req">*</span></label>
          <input id="firstName" name="firstName" type="text" autocomplete="given-name" required>
        </div>
        <div class="f">
          <label for="lastName">Last name <span class="req">*</span></label>
          <input id="lastName" name="lastName" type="text" autocomplete="family-name" required>
        </div>
        <div class="f">
          <label for="phone">Cell phone <span class="req">*</span></label>
          <input id="phone" name="phone" type="tel" autocomplete="tel" inputmode="tel" maxlength="14" placeholder="(325) 555-0134" required>
          <p class="help">So we can call you, if needed. We will only text you if you tick the box below.</p>
        </div>
        <div class="f">
          <label for="email">Email <span class="opt">if you have one</span></label>
          <input id="email" name="email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com">
        </div>
        <div class="f full">
          <label for="city">Town you live in <span class="req">*</span></label>
          <input id="city" name="city" type="text" autocomplete="address-level2" placeholder="Abilene" required>
        </div>
        <label class="consent full"><input type="checkbox" id="okToText" name="okToText"><span>I agree to receive SMS text messages from Resilient Arena about boarding and arena rental notices. Message frequency varies. Message &amp; data rates may apply. Reply STOP to unsubscribe or HELP for help. Consent is not a condition of purchase. See our <a href="/privacy/">Privacy Policy</a> and <a href="/terms/">Terms of Service</a>.</span></label>
      </div>
    </div>

    <div class="form-group">
      <div class="step-label">The job</div>
      <div class="form-grid">
        <div class="f full f--short">
          <label for="roleFit">This job is two days a week to start. Can you commit to that? <span class="req">*</span></label>
          <select id="roleFit" name="roleFit" required>
            <option value="">Pick one</option>
            ${['Two days a week suits me', 'Two days now, want full time later', 'Only interested if it\u2019s full time'].map(option).join('')}
          </select>
          <p class="help">Answer honestly. If you need full time today, say so and we will keep you in mind as we grow.</p>
        </div>
        <div class="f full f--short">
          <label for="desiredHours">How many hours are you looking for overall? <span class="req">*</span></label>
          <select id="desiredHours" name="desiredHours" required>
            <option value="">Pick one</option>
            ${['Full time', 'Part time', 'Weekends only', 'Fill-in / as needed'].map(option).join('')}
          </select>
        </div>
        <div class="f full" id="f-posn">
          <div class="lbl" id="lbl-posn">What kind of work are you interested in? <span class="req">*</span> <span class="opt">tap all that apply</span></div>
          <div class="chips" role="group" aria-labelledby="lbl-posn">
            ${[['Barn Help / Stalls', 'Barn help / stalls'], ['Feed & Turnout', 'Feed & turnout'], ['Arena Maintenance', 'Arena maintenance'], ['Groom', 'Groom'], ['Exercise Rider', 'Exercise rider'], ['General Ranch Hand', 'General ranch hand'], ['Maintenance & Repair', 'Maintenance & repair'], ['Facility Manager', 'Facility manager'], ['Whatever You Need', 'Whatever you need']].map(([v, l]) => chip('positionInterest', v, l)).join('\n            ')}
          </div>
          <p class="help">The open job is arena and grounds work. Tell us anything else you would take on as we grow.</p>
        </div>
        <div class="f full" id="f-avail">
          <div class="lbl" id="lbl-avail">Which days do you prefer to work? <span class="req">*</span> <span class="opt">pick two</span></div>
          <div class="chips" role="group" aria-labelledby="lbl-avail">
            ${['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => chip('availability', d)).join('\n            ')}
          </div>
          <p class="help">Pick the two that suit you best. Nothing is locked in, we will settle on your days together.</p>
        </div>
        <div class="f full f--short">
          <label for="startDate">When could you start? <span class="req">*</span></label>
          <input id="startDate" name="startDate" type="date">
          <p class="help">A best guess is fine.</p>
        </div>
      </div>
    </div>

    <div class="form-group">
      <div class="step-label">Grounds and equipment work</div>
      <div class="form-grid">
        <div class="f full" id="f-grounds">
          <div class="lbl" id="lbl-grounds">Which of these have you done before? <span class="req">*</span> <span class="opt">tap all that apply</span></div>
          <div class="chips" role="group" aria-labelledby="lbl-grounds">
            ${['Mowing', 'Weed eating', 'Herbicide / weed spraying', 'Tractor & arena drag', 'Fence repair', 'Welding', 'Small engine maintenance', 'Basic plumbing / electrical', 'Brush & tree clearing', 'Pressure washing', 'Stall cleaning', 'Trailer driving'].map((v) => chip('groundsSkills', v)).join('\n            ')}
            ${chip('groundsSkills', 'Other', 'Something else', 'skillsOther')}
          </div>
          <p class="help">This is the main part of the job. Tap everything you have hands-on experience with, even if it was years ago.</p>
          <div class="otherwrap" id="skillsOtherWrap" hidden>
            <label for="otherSkills">What else have you done? <span class="opt">optional</span></label>
            <input id="otherSkills" name="otherSkills" type="text" placeholder="Anything that is not on the list">
          </div>
        </div>
        <div class="f full" id="f-equip">
          <div class="lbl" id="lbl-equip">What equipment can you run? <span class="req">*</span> <span class="opt">tap all that apply</span></div>
          <div class="chips" role="group" aria-labelledby="lbl-equip">
            ${['Tractor', 'Skid steer', 'Arena drag', 'UTV', 'Truck & gooseneck', 'Truck & bumper pull', 'Mower / shredder', 'Chainsaw'].map((v) => chip('equipment', v)).join('\n            ')}
            ${chip('equipment', 'None yet', 'None yet, happy to learn')}
            ${chip('equipment', 'Other', 'Something else', 'equipOther')}
          </div>
          <p class="help">If you have never run any of it, tap None yet. We will teach you.</p>
          <div class="otherwrap" id="equipOtherWrap" hidden>
            <label for="otherEquipment">What else can you run? <span class="opt">optional</span></label>
            <input id="otherEquipment" name="otherEquipment" type="text" placeholder="Anything that is not on the list">
          </div>
        </div>
        <div class="f full f--short">
          <label for="applicator">Have you sprayed weeds or brush before? <span class="opt">optional</span></label>
          <select id="applicator" name="applicator">
            <option value="">Pick one</option>
            ${['Yes - licensed applicator', 'Have sprayed, not licensed', 'No, but willing to get licensed', 'No experience spraying'].map(option).join('')}
          </select>
        </div>
      </div>
    </div>

    <div class="form-group">
      <div class="step-label">Horses and livestock</div>
      <div class="form-grid">
        <div class="f full f--short">
          <label for="horseExperience">How comfortable are you around horses? <span class="req">*</span></label>
          <select id="horseExperience" name="horseExperience" required>
            <option value="">Pick one</option>
            ${['None - willing to learn', 'Some - been around horses', 'Experienced - handle horses daily', 'Professional - worked in the industry'].map(option).join('')}
          </select>
          <p class="help">You do not need horse experience for this job. There are horses here, so we like to know.</p>
        </div>
        <div class="f full f--short">
          <label for="horseYears">About how many years have you been around horses? <span class="opt">optional</span></label>
          <input id="horseYears" name="horseYears" type="text" inputmode="numeric" placeholder="0">
          <p class="help">Whole years. Put 0 if none.</p>
        </div>
        <div class="f full">
          <div class="lbl" id="lbl-horse">Any horse or cattle work you have done? <span class="opt">optional, tap all that apply</span></div>
          <div class="chips" role="group" aria-labelledby="lbl-horse">
            ${['Haltering & leading', 'Horse turnout', 'Stall cleaning', 'Feeding horses', 'Wrapping & leg care', 'Giving shots / meds', 'Foaling', 'Handling horses', 'Feeding cattle', 'Branding', 'Sorting cattle', 'Hauling cattle', 'Cattle sales', 'Fence repair', 'Welding', 'Basic plumbing', 'Electrical', 'Mowing & spraying', 'Trailer driving'].map((v) => chip('horseSkills', v)).join('\n            ')}
          </div>
          <p class="help">None of this is required for the job. It tells us what else you could grow into.</p>
        </div>
      </div>
      <div class="checks">
        <label class="check"><input type="checkbox" name="license" required><span>I have a valid driver&rsquo;s license <span class="req">*</span></span></label>
        <label class="check"><input type="checkbox" name="transportation" required><span>I have a reliable way to get to and from work <span class="req">*</span></span></label>
        <label class="check"><input type="checkbox" name="workAuth" required><span>I am legally allowed to work in the United States <span class="req">*</span></span></label>
      </div>
    </div>

    <div class="form-group">
      <div class="step-label">In your own words</div>
      <div class="form-grid">
        <div class="f full">
          <label for="workHistory">Where have you worked, and what did you do? <span class="req">*</span></label>
          <textarea id="workHistory" name="workHistory" placeholder="Ranches, landscaping, construction, anywhere. Roughly when, and what you were in charge of." required></textarea>
          <p class="help">A few sentences is plenty. You do not need a resume.</p>
        </div>
        <div class="f full">
          <label for="whyUs">Why do you want this job? <span class="opt">optional</span></label>
          <textarea id="whyUs" name="whyUs"></textarea>
        </div>
        <div class="f">
          <label for="rate">What pay are you hoping for? <span class="opt">optional</span></label>
          <input id="rate" name="rate" type="text" inputmode="decimal" autocomplete="off">
          <p class="help">A dollar amount per hour. Numbers only.</p>
        </div>
        <div class="f">
          <label for="heardFrom">How did you hear about us? <span class="opt">optional</span></label>
          <select id="heardFrom" name="heardFrom">
            <option value="">Pick one</option>
            ${['Facebook', 'Word of mouth', 'Sign at the arena', 'Someone who works here', 'Search / online', 'Other'].map(option).join('')}
          </select>
        </div>
        <div class="f full">
          <label for="resume">Resume <span class="opt">only if you have one</span></label>
          <input id="resume" name="resume" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png,.heic">
          <p class="help">A PDF, a Word file, or a photo of a printed one. Photos are shrunk automatically. Skipping this will not negatively affect your submission.</p>
        </div>
      </div>
    </div>

    <p class="formmsg" id="formMsg" hidden role="alert"></p>

    <div class="send">
      <button class="btn" type="submit" id="submitBtn">Send my application</button>
      <p>We read every one. You will hear back within seven days.<br>Rather talk to a person? <a href="tel:${PHONE_TEL}">Call us at ${PHONE_SHOWN}</a>.</p>
    </div>
  </form>

  <div class="done" id="done" hidden>
    <div class="done-icon">&#10003;</div>
    <h2>Thank you</h2>
    <p>Your application is in. We will get back to you within seven days. If you gave us a cell number, look for a call or a text.</p>
  </div>
</article>`;
}

const EMPLOYMENT = {
  'Part time': 'PART_TIME',
  'Part time to start': 'PART_TIME',
  'Full time': 'FULL_TIME',
  'Seasonal': 'TEMPORARY',
  'As needed': 'PER_DIEM',
};

/* What a search engine reads to list the job. Only ever built for a
   job that is open. */
function jobPosting(job, url) {
  const html = [
    ...job.intro.map((t) => `<p>${esc(t)}</p>`),
    job.duties.length ? `<ul>${job.duties.map((d) => `<li>${esc([d.heading, d.detail].filter(Boolean).join(' '))}</li>`).join('')}</ul>` : '',
    ...job.fitClosing.map((t) => `<p>${esc(t)}</p>`),
  ].join('') || `<p>${esc(job.summary || job.title)}</p>`;

  const ld = {
    '@context': 'https://schema.org/',
    '@type': 'JobPosting',
    title: job.title,
    description: html,
    identifier: { '@type': 'PropertyValue', name: 'Resilient Arena', value: job.slug },
    url,
    datePosted: /^\d{4}-\d{2}-\d{2}/.test(job.datePosted) ? job.datePosted.slice(0, 10) : job.created.slice(0, 10),
    directApply: true,
    hiringOrganization: {
      '@type': 'Organization', name: 'Resilient Arena', sameAs: SITE, telephone: '+1-325-627-3726',
    },
  };
  if (EMPLOYMENT[job.type]) ld.employmentType = [EMPLOYMENT[job.type]];
  const place = /^(.+?),\s*([A-Za-z]{2})$/.exec(job.location);
  if (place) {
    ld.jobLocation = {
      '@type': 'Place',
      address: {
        '@type': 'PostalAddress', addressLocality: place[1],
        addressRegion: place[2].toUpperCase(), addressCountry: 'US',
      },
    };
  }
  if (job.schedule) ld.workHours = job.schedule;
  return ld;
}

function jobPage(job, { preview = false } = {}) {
  const url = `${SITE}/hiring/${job.slug}`;
  const where = job.location ? `Resilient Arena, ${job.location}` : 'Resilient Arena';
  const glance = [
    ['Schedule', job.schedule], ['Pay', job.pay], ['Where', where],
    ['What you need', job.need], ['Where it can go', job.future],
  ].filter(([, v]) => v);
  const description = clip(job.summary || job.intro[0] || `${job.title} at Resilient Arena.`, 300);

  const body = `<main>
  <section class="doc">
    ${preview ? `<p class="preview-note"><strong>Preview.</strong> This job is not posted yet. Only someone with this exact link can see it. It goes on the website when its status is set to Open.</p>` : ''}
    <a class="back" href="/hiring"><span aria-hidden="true">&larr;</span> All open positions</a>

    <div class="jobhead">
      <div class="tag">Now hiring${job.location ? ` &middot; ${esc(job.location)}` : ''}</div>
      <h1>${accent(job.title)}</h1>
      ${paras(job.intro, 'lede')}
    </div>

    <div class="jobcols">
      <aside class="card glance">
        <div class="step-label">At a glance</div>
        <dl>
          ${glance.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('\n          ')}
        </dl>
        <a class="btn btn--full" href="#apply">Apply for this job</a>
        <p class="glance-note">Takes about five minutes.</p>
      </aside>

      <div class="jobmain">
${jobSections(job)}

${applyForm(job)}
      </div>
    </div>
  </section>

  <div class="applybar" id="applybar">
    <div><b>${esc(job.title)}</b>About five minutes</div>
    <a class="btn" href="#apply">Apply</a>
  </div>
</main>`;

  return layout({
    title: `${job.title} - Now hiring${job.location ? ` in ${job.location}` : ''} - Resilient Arena`,
    description,
    canonical: url,
    index: !preview,
    shareTitle: `Now hiring: ${job.title}${job.location ? ` - ${job.location}` : ''}`,
    jsonLd: preview ? null : jobPosting(job, url),
    body,
    scripts: '<script src="/assets/hiring-apply.js" defer></script>',
  });
}

/* ------------------------------------------------------------------
   The three pages that are one plain card.
   ------------------------------------------------------------------ */
function notice({ title, tag, heading, text, description }) {
  const body = `<main>
  <section class="doc">
    <div class="card notice">
      <div class="tag">${tag}</div>
      <h1>${heading}</h1>
      ${text.map((t) => `<p>${t}</p>`).join('\n      ')}
      <div class="notice-actions">
        <a class="btn" href="/hiring">See open positions</a>
        <a class="link" href="${NOTE_HREF}">Send us a note</a>
      </div>
    </div>
  </section>
</main>`;
  return layout({ title, description, canonical: null, index: false, body });
}

/* A closed job keeps its link alive. Someone who saved it, or found it
   in an old post, is told what happened and shown where to go next. */
function closedPage(job) {
  return notice({
    title: `${job.title} - Position filled - Resilient Arena`,
    description: `The ${job.title} position at Resilient Arena has been filled.`,
    tag: 'Position filled',
    heading: accent(job.title),
    text: [
      'This position has been filled. Thank you for your interest.',
      'We are a growing outfit. See what else is open, or tell us what kind of work you do and we will keep you in mind.',
    ],
  });
}

function notFoundPage() {
  return notice({
    title: 'Job not found - Resilient Arena',
    description: 'That job page could not be found.',
    tag: 'Jobs',
    heading: 'We could not find that job',
    text: ['The link may be mistyped, or the job may have been taken down. Every job we have open is on one page.'],
  });
}

function troublePage() {
  return notice({
    title: 'Jobs - Resilient Arena',
    description: 'The jobs list is not loading right now.',
    tag: 'Jobs',
    heading: 'The jobs list is not loading right now',
    text: [`Please try again in a few minutes. If you would rather talk to a person, call us at <a class="link" href="tel:${PHONE_TEL}">${PHONE_SHOWN}</a>.`],
  });
}

module.exports = { listPage, jobPage, closedPage, notFoundPage, troublePage };
