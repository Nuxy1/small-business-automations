# Small-business automations

Four working automations for made-up local businesses: booking reminders for a dog groomer, lead follow-up for a plumber, invoice reminders for a cleaning company and review requests for a salon. Each one cleans messy real-world data, never sends the same message twice, never fails silently, and keeps quiet at night. Zero dependencies, Node 20+.

The businesses are invented for the demo: every address ends in `.example` and every phone number is a 555 number, so nothing here can reach a real person.

| Automation | For | What it does |
|---|---|---|
| [Booking reminders](booking-reminders/index.js) | Prairie Paws Grooming | A confirmation the moment someone books online, with a link to move or cancel; a reminder the day before and 2 hours before, never at night. A moved booking gets new reminders, a cancelled one none, and the owner gets the day's schedule each morning. |
| [Lead follow-up](lead-follow-up/index.js) | Northfield Plumbing Co. | Every website inquiry gets an instant reply and the owner an alert with the phone number; two friendly follow-ups (after 1 and 3 days) unless the customer replies first. The same person sending the form twice is one conversation. |
| [Invoice reminders](invoice-reminders/index.js) | Cannon River Cleaning | Reads the open-invoices export (QuickBooks, Wave, Square or a sheet) and sends reminders 3, 7 and 14 days after the due date, with partial payments shown. At 30 days the owner is told to step in. A list every Monday. |
| [Review requests](review-requests/index.js) | Juniper & Rose Salon | A thank-you with the Google review link a couple of hours after each visit; never after a no-show or cancellation, never twice in 180 days, never to anyone who said stop. |

## Try it

```
npm test        # 12 tests, messy data included
npm run demo    # a simulated week of all four; every email lands in demo/outbox/
npm run bench   # 5,000 messy records through each one, timed
```

On my PC (a Ryzen 7 desktop), `npm run bench` gives: 5,000 form submissions with repeats, typos and bad emails in 0.14 s, with no customer emailed twice; a 5,000-row invoice export read and checked in 0.18 s; 5,000 salon visits in 0.08 s; and 5,000 bookings confirmed and checked for reminders in 1.4 s. A small business's whole year fits in well under a second.

The demo prints the week as it happens:

```
Lead follow-up: Northfield Plumbing Co. (made up)
  Mon 09:10  form: {"name":"MARIA GONZALEZ","email":"Maria.Gonzalez@Gmial.com","phone":"507.555.0110",...}
  Mon 09:10  -> owner@northfield-plumbing.example    New inquiry: Maria Gonzalez
  Mon 09:10  -> maria.gonzalez@gmail.com             Thanks for contacting Northfield Plumbing Co.
  Mon 09:40  -> owner@northfield-plumbing.example    Maria wrote again
  Mon 21:15  -> wei.chen@example.com                 Thanks for contacting Northfield Plumbing Co.
  Tue 10:00  -> owner@northfield-plumbing.example    New inquiry with no way to reply automatically: Bob
  Tue 10:00  -> maria.gonzalez@gmail.com             Following up: Northfield Plumbing Co.
  Tue 15:00  Maria replied: her follow-ups stop
  Wed 09:00  -> wei.chen@example.com                 Following up: Northfield Plumbing Co.
  Fri 09:00  -> wei.chen@example.com                 Still happy to help: Northfield Plumbing Co.
```

## The promises, and how each is kept

**Never twice.** Every message has a key (`invoice:1042:day-7`, `lead:<id>:follow-up:1`). A key that went out is never sent again, however often the automation runs, so it can safely run every few minutes and after a restart. ([core/mail.js](core/mail.js))

**Never silently.** A send that fails is retried three times with growing waits, then the owner is told what didn't go and why, and it's tried again on the next run. A send that was cut off halfway (a crash, a lost connection) is *not* repeated blindly: the owner gets a "check by hand" note instead. If even the owner's alert can't be sent, it is written to the state file and printed.

**Messy data, nothing guessed.** Names in capitals, emails with typos (`@gmial.com`), phones in any format, dates as `10/02/2026`, `Oct 25 2026` or `2026-10-20`, money as `$1,240.00`. What can be cleaned is; what can't (an impossible date, an email with no `@`) goes to the owner with the reason, never into an email. ([core/normalize.js](core/normalize.js), shared with [csv-contact-cleaner](https://github.com/Nuxy1/csv-contact-cleaner))

**Business hours and quiet hours.** Time is the business's own (America/Chicago here), daylight saving included: a reminder is never a day early, follow-ups and review requests wait for 9 a.m. instead of arriving at night, and invoice reminders go out on weekdays only. An instant reply is the exception: the customer just wrote. ([core/time.js](core/time.js))

**The state survives a crash.** What was sent is kept in one JSON file written atomically (a new file, then a rename), so a power cut can't leave half a file. ([core/store.js](core/store.js))

**People stay in charge.** Every follow-up stops the moment the customer replies; a 30-days-late invoice goes to the owner, not to a fourth email; anyone who replies "stop" to a review request is never asked again; everyone gets the same public review link (asking only happy customers is against Google's rules).

## How this is used for a real client

For a real business the same logic runs inside their own accounts:

- **Their tools' own features first.** If the booking tool, point of sale or accounting app can already send reminders or review requests, I switch those on and set them up properly instead of writing code. Custom code is for what their tools can't do.
- **The transport is theirs.** Here, `outbox()` writes each email to a folder. In a client's setup it is their own email account or the tool they already use; the keys, retries and alerts stay the same.
- **Tested on their messy data first.** A dry run on a copy of their real export, every message read by a person before anything goes live.

## Limits (on purpose, for small businesses)

- The state is a JSON file: right for a few thousand customers, not for a large company's database.
- The lead server ([lead-follow-up/server.js](lead-follow-up/server.js)) is a minimal webhook with a shared secret. In production it sits behind HTTPS (Caddy or the host's proxy).
- Text messages aren't included: they need a paid SMS provider per client, set up in their account.

MIT licence.
