# Terms review, before going live

Tyesha reads and signs off this page before the site takes real money, and
again after any change to the terms, the deposit rules, or the booking
window. The point is not to re-read the legal prose. It is to check that
every promise the terms make is still one the business can keep.

Work down the two tables. The first is enforced by code, so the check is
"do the numbers still match". The second is enforced by a person, so the
check is "are we actually doing this".

---

## 1. Promises the code keeps

If a number here stops matching, the site is lying to a customer. Each row
names the file that decides it.

| The terms say | What decides it | Check |
|---|---|---|
| Arena deposit is **half the rental** | `DEPOSIT_PCT = 0.5` in `api/reservations.js` | Still 0.5, and the arena page still says 50% |
| Pen deposit is **half the first month's board** | `PEN_DEPOSIT_PCT` env var, default 0.5, in `api/pen-hold.js` | Env var unset, or set to 0.5 |
| Start dates up to **thirty days** ahead | `PEN_MAX_DAYS_AHEAD` env var, default 30, in `api/pen-hold.js` | Env var unset, or set to 30 |
| Paying **takes the space off the market** | `holdPen()` in `api/stripe-webhook.js` | Test a hold end to end and watch the pen move to Hold / Reserved |
| **We do not store your card number** | Stripe Elements; the card never reaches our server | Still true as long as nobody adds a card field of our own |
| Waitlist: **everyone is texted at once, first to reach us wins** | `api/notify-waitlist.js`, cron every 15 minutes | Cron still in `vercel.json`, message text still says this |
| **We only text people who separately opt in** | The consent box, unticked by default, on every form | No form ticks it for them |

### The thirty-day number lives in three places

`PEN_MAX_DAYS_AHEAD` is a Vercel environment variable, so it can be changed
without touching this repo. If it ever moves off 30, all three of these go
stale and must be changed together:

1. `PEN_MAX_DAYS` in `index.html` — the date picker's limit and the hint text
2. "Start dates can be booked up to thirty days ahead" in `terms/index.html`
3. This file

---

## 2. Promises a person keeps

Nothing in the code does these. They are real commitments made to a paying
customer, so either the office does them or the wording comes out.

| The terms say | Who does it | Still willing to? |
|---|---|---|
| The deposit is **credited to your first month** | Whoever raises the first invoice | |
| A hold can be **moved once, at no charge** | Office, by hand. Nothing counts the moves | |
| A hold **not taken up is forfeited** | Office, by hand | |
| **If we cancel, the deposit comes back in full** | Refund in the Stripe dashboard | |
| **Replies to our texting number are not monitored** | True today. Stays true only if nobody starts watching it | |

### A pen held past its start date is never released

Paying holds a pen "until the start date you chose". If the person then
never turns up, nothing moves the pen back to Available — it sits on
Hold / Reserved until somebody changes it in Airtable. That is a gap
between the terms and the system, not a bug in either. Either watch the
Pen Reservations table by hand, or say the word and it gets a cron like
the waitlist already has.

---

## 3. Before the first real payment

- [ ] Swap the three Stripe variables in Vercel from test to live keys,
      and take the live `whsec_` from the `resilient-arena` destination
- [ ] Rename the Stripe account. It is still **Resilient Farms Arena**,
      which is what appears on a card statement, and a name the customer
      does not recognise is how disputes start
- [ ] Re-stamp the effective date on `terms/index.html` if the wording
      changed again since 5 September 2026
- [ ] Run one real hold with a real card, refund it, and confirm the pen
      went to Hold / Reserved and back
