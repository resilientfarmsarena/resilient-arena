# Resilient Arena — build brief

Two sites. Both prototypes are finished, self-contained HTML files. Nothing here
needs redesigning. The job is to turn them into real deployed sites without
changing how they look or read.

---

## What you are getting

    index.html                  The arena website prototype (resilientarena.com)
    hire/index.html             The hiring page (hire.resilientarena.com)
    hire/job-page-TEMPLATE.html Copy this to post a second role
    assets/                     Every photo, the video, and the font
    api/                        Serverless functions. These hold the Airtable token.
    archive/                    The signed-off snapshots, not deployed:
                                  arena-website-V1.html
                                  hiring-page-V1.html
    BUILD-BRIEF.md              This file

Everything is ALSO embedded inside the HTML as base64 — that is why index.html is
1.9 MB. The files in `assets/` were extracted straight out of it, so they are
byte-identical to what the prototype shows.

First job on build: strip the base64 out of index.html and point at `assets/`
instead.

    assets/hero-aerial.jpg        hero background, sepia toned
    assets/card-pastures.jpg      Pastures service card
    assets/card-traps.jpg         Traps service card
    assets/card-arena.jpg         Arena service card
    assets/arena-clip.mp4         film band video, muted loop, no controls
    assets/arena-clip-poster.jpg  its poster frame
    assets/ZinDisplay-Bold.woff2  use this one
    assets/ZinDisplay-Bold.otf    source, do not ship

There is no photo for the Stalls card. It is still a stock image pointing at an
unsplash URL. Replace it with a real photo before launch.

---

## Rules that must not change

These were decided deliberately. Do not "improve" them.

- Fonts: Zin Display Bold for all headings, wordmark, and figures. Jost for
  everything else. Zin is licensed and self-hosted. Use the subset woff2 in
  assets, not the OTF.
- Every button and boxed element: 10px border radius.
- Every form field: full border all the way around, 10px radius.
- Checkboxes: rounded squares, never circles.
- Error states: dark red #9B3A2E text and border on faded red #F6E7E3.
- Body text: one CSS variable controls every paragraph and label. Keep it that way.
- The name is "Resilient Arena" everywhere. Never "Resilient Farms Arena".
- No em dashes anywhere on the site. Not in body copy, not in headings,
  titles, labels or step names. Use a normal hyphen, or reword. Run
  `npm run check:dashes` to enforce it; it scans the shipped pages and
  the api functions, and fails on the character or either HTML entity.

## Palette

    --cream        #F5F0E8      --gold          #8F8967
    --warm-white   #FDFAF5      --gold-light    #5C5A42
    --earth        #3A382E      --charcoal      #1E1A16
    --sage         #6B7B5E      --danger        #9B3A2E
    --sage-light   #C8D4BC      --danger-bg     #F6E7E3

---

## Site 1 — resilientarena.com

Sections in order: header, hero, stats strip, service cards, facility map,
arena reservation, film band, contact, footer.

### Airtable

Boarding base `appww5dZtWrtQJiqu`, table "Stalls, Traps, Pastures".
Field IDs are already in the config block at the top of the script. The map and
the Available Pens count both read from it.

There is sample data in the file (`SAMPLE_RECORDS`) so the map works with no
token. It disappears on its own the moment a real token is set. Leave that in
during development, drop it at launch.

Structure dimensions live in table `tblTawHGm0K3Hnu5a` in the same base — exact
vs advertised. The site shows the advertised figures.

### The map

Leaflet with Esri satellite tiles. No API key needed. There is an unused
`GOOGLE_MAPS_KEY` in the config, left over — delete it.

Pins: green available, dark red leased, amber hold, near-black unavailable.
Tapping a pin opens the detail sheet directly, no intermediate popup.

Detail sheet, available pen: type / price / cover, pen name, lease start date,
"Request to lease", then an "Ask a question" box.
Detail sheet, leased pen: one line saying it is leased plus "Ask to be notified".

Both buttons currently just show a confirmation panel. They need wiring.

### Reservation flow

Hourly and full day. Event rental is built but hidden behind
`SHOW_EVENT_RENTAL = false`. Leave it false.
50% deposit, non-refundable, stated on the review step. Stripe is stubbed.

### Still to do

1. Extract embedded assets to `assets/` and reference by path.
2. Move the Airtable token server-side. It cannot ship in the page.
3. Wire "Request to lease" and "Ask a question" to Airtable.
4. Build the waitlist: "Ask to be notified" writes a row, and when a pen's
   status flips to Available, everyone waiting on it gets told automatically.
5. Wire the contact form. Validation and the confirmation panel already work.
6. Confirm resilientarena.com and app.resilientarena.com DNS.

All facility figures are final. Do not change them.

---

## Site 2 — hire.resilientarena.com

One page, one open role: Arena & Grounds Caretaker. Two full days a week, the
applicant picks which two.

### Airtable

Base `appEh5qi4D2stYTFe`, table `tbl1mKpAjKxyX47Wn` ("Arena Candidates").
The form writes by field ID, so renaming a column will not break it. It stamps
Status "New", Source "Hiring Page Form", and Applied On automatically.

Chip values must match the Airtable select options exactly or the answer is
silently dropped. `typecast` is on, so unknown options get created rather than
rejected — watch for junk options if anyone edits the chip labels.

### Deliberate choices

- No exit links in the header. The wordmark is plain text, not a link. This page
  has one job.
- Applicants are told seven days, not two.
- Day picker is capped at exactly two. Extra days grey out.
- No references question. It was removed on purpose.
- Phone (325) 627-3726 sits under the centered submit button as a `tel:` link.

### Still to do

1. Move the Airtable token server-side, same as the arena site.
2. Resume upload needs a file host. Attachments cannot go straight to Airtable
   from the browser.
3. 1099 vs W2 is still undecided. The page deliberately says nothing about it.
   Do not add a line either way until Tyesha decides.
4. `job-page-TEMPLATE.html` exists for posting a second role. Later, a Positions
   table could generate these pages instead of copying the file.

---

## Ordering

Both sites are static and can deploy to Vercel as-is once the assets are
extracted. The token work is the only thing blocking a real launch, and it is
the same fix on both: a small serverless function holding the key, with the
page posting to it instead of calling Airtable directly.
