# Google Calendar — discovery-call availability

The Talk to Sales confirmation page offers a customer real, bookable discovery-call
slots. Those slots are computed from the sales team's actual free/busy, and the
booking creates a real calendar event. This document is the production setup and
the reasoning behind the approach.

The integration is off by default. When it is off, the app does **not** pretend
otherwise: the fallback provider labels itself "Demo availability — Google
Calendar not configured" everywhere it appears (customer booking step, booking
confirmation, Home dashboard, Schedule page), and the Schedule page shows the
integration as unconfigured with the exact variables that are missing.

## How availability is aggregated

The cleanest production shape for "when can a customer meet someone from sales"
is a **service account reading free/busy across the reps' own calendars**, not a
single shared team calendar and not per-rep OAuth.

- **Service account, not OAuth per rep.** Availability has to be computed for an
  anonymous website visitor, with no rep present to consent. OAuth refresh
  tokens per rep would need storing, rotating and re-consenting when they lapse;
  a service account has no interactive session to expire.
- **Their own calendars, not a shared one.** A rep's real conflicts live in their
  own calendar. Aggregating the individual calendars means a slot is offered only
  when someone is genuinely free — a shared team calendar would only know about
  meetings people remembered to copy into it.
- **`freeBusy`, not `events.list`.** One request returns busy windows for every
  calendar at once. It returns no titles, attendees, locations or descriptions,
  so the app is structurally incapable of leaking a rep's meeting details into a
  customer-facing page even by accident. The customer-facing `/api/availability`
  response narrows it further, to slot start/end times and a provider label.
- **Collapse to slots server-side.** `computeAvailability()` walks business days
  in the team's time zone, cuts them into slots, and keeps a slot when at least
  `SALES_MIN_FREE_REPS` calendars are free for it. The browser is told the times
  only — never which rep is free, which is both a privacy property and what lets
  the rep be chosen at booking time.
- **Re-verify at booking.** The slot list a browser is holding may be minutes
  old. `bookDiscoveryCall()` re-reads free/busy for that exact slot before
  creating anything, so two customers racing for the same time cannot both get
  it.

## Setup

### 1. Google Cloud project

1. Create (or pick) a project in the Google Cloud console.
2. Enable the **Google Calendar API**.
3. Create a **service account**. No project IAM roles are needed — Calendar
   access comes from calendar sharing, not IAM.
4. Create a **JSON key** for it and keep the file safe.

### 2. Give it the reps' free/busy

For each salesperson whose availability should count, in their Google Calendar:
Settings → *Share with specific people* → add the service account's email
address with **"See only free/busy (hide details)"**.

That permission is enough for availability. The one calendar the event is
actually created on needs **"Make changes to events"** instead.

### 2b. When the organisation blocks sharing outside the domain

A Workspace admin can switch off sharing calendars outside the organisation. A
service account counts as outside, so in the share dialog every option except
**"See only free/busy"** is greyed out. Availability still works — that is the
permission it needs — but the event has nowhere to be created.

The way through is a calendar the service account owns itself, which no policy
blocks:

```bash
npm run gcal:check     # authenticates, and says which sales calendars are really shared
npm run gcal:setup     # the above, plus creates the booking calendar and shares it back to you
```

`gcal:setup` prints a `SALES_BOOKING_CALENDAR=` line to paste into `.env.local`, and
grants your own account writer access so bookings appear in your Google Calendar
once you subscribe to that id (Other calendars → + → Subscribe to calendar).

### 3. Invitations (optional but recommended)

A bare service account may create an event but Google will refuse to let it
invite attendees — it returns `forbiddenForServiceAccounts`. The app handles this:
it retries without attendees, stores `invited: false`, and the confirmation page
tells the customer the team will send the invitation. To have Google send
invitations properly, enable **domain-wide delegation**:

1. Google Workspace Admin → Security → Access and data control → API controls →
   Domain-wide delegation.
2. Add the service account's **client ID** with the scopes
   `https://www.googleapis.com/auth/calendar.events` and
   `https://www.googleapis.com/auth/calendar.readonly`.
3. Set `GOOGLE_CALENDAR_IMPERSONATE` to a Workspace user the service account
   should act as (typically the sales-operations mailbox).

### 4. Environment variables

| Variable | Required | What it does |
| --- | --- | --- |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | yes | The key file contents, raw JSON or base64. (`GOOGLE_SERVICE_ACCOUNT_EMAIL` + `GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY` work instead.) |
| `GOOGLE_CALENDAR_IMPERSONATE` | no | Workspace user to act as, so Google sends invitations. |
| `SALES_CALENDARS` | no | Comma-separated rep calendar ids. Defaults to every team member's email in `app_users`. |
| `SALES_BOOKING_CALENDAR` | no | Calendar the event is created on. Defaults to the assigned rep's calendar. |
| `SALES_TIMEZONE` | no | IANA zone the team works in. Default `America/New_York`. |
| `SALES_HOURS` | no | Business hours, `09:00-17:00`. Weekdays only. |
| `DISCOVERY_SLOT_MINUTES` | no | Slot length. Default 30. |
| `SALES_MIN_FREE_REPS` | no | Reps that must be free for a slot to be offered. Default 1. |
| `SALES_BOOKING_DAYS` | no | Business days ahead to offer. Default 5. |
| `SALES_MIN_NOTICE_HOURS` | no | Earliest bookable slot from now. Default 2. |

On Vercel, put the JSON key in a **Sensitive** environment variable; base64 it if
the newlines in `private_key` cause trouble. Nothing in the code changes between
environments: `getCalendarProvider()` returns the Google provider when the
credentials parse and the labelled local provider when they do not.

### 5. Verify

Open **Schedule** in the Sales Engine. When it is live the card reads "Connected
— availability is real free/busy" and lists each sales calendar. A calendar that
was never shared with the service account shows as **not shared**, and its owner's
time is treated as free until they share it — so check that list rather than
assuming the connection is complete.

## What the fallback does

With no credentials, `LocalAvailabilityProvider` serves business-hours slots
minus discovery calls already booked in this database, so a demo cannot
double-book a time. It creates no calendar events and sends no invitations, and
says so in the booking confirmation. It exists to keep local development and
demos working — it is never presented as Google Calendar.

## Privacy

- Only free/busy is ever read. No event titles, attendees, locations or
  descriptions are requested, stored or displayed.
- The customer-facing endpoint returns slot times and a provider label. Which rep
  is free is computed server-side and never sent to the browser.
- Rep calendar addresses appear on the internal Schedule page only.
