# Handoff contract — Ready to Contract

The boundary of this application. It owns the front half of the Sales Engine
lifecycle and publishes what it learned; contracting is a separate application.

```
Sales Engine (this app)                                        Contracting (separate)
Customer Inquiry → Opportunity → Qualification → AI Opportunity Intelligence → Quote Context → [Continue to Contract →]   →   Quote → Approval → Contract → E-signature → Renewal
```

When a rep presses **Continue to Contract →** on a qualified opportunity, this
application:

1. Assembles the quote context (payload below) — the opportunity, customer, contacts, qualification, requirements and AI insights.
2. Moves the opportunity to the **Ready to Contract** stage.
3. Records a timestamped handoff activity on the timeline with exactly what was handed over.

Nothing has to be running anywhere else for that to happen. Whoever builds
contracting **pulls** the payload when they want it — there is one endpoint and
it is read-only.

## One customer, never duplicated

`customer.key` is stable on both sides: the company's email domain (`acme.com`), or a slug of the name when the domain is a free-mail provider. **Upsert on `customer.key`.** A second inquiry from the same company arrives with the same key and a new `opportunity` — it must attach to the existing account, exactly as renewals do on your side.

## Pull — how you read it

```
GET {SALES_ENGINE_URL}/api/handoff/{lead_id}
X-Sales-Engine-Key: <shared HANDOFF_API_KEY>      # or an Admin browser session
```

Returns the payload below. `200` with the context, `404` if the opportunity does
not exist, `401`/`403` without the key or the role. Poll it, or read it once when
a rep tells you an opportunity is ready — the stage and the timeline entry on our
side are the signal that it is.

## Pull — fetching it yourself

```
GET {LEAD_WORKSPACE_URL}/api/handoff/{lead_id}
X-Sales-Engine-Key: <shared HANDOFF_API_KEY>
```

Returns the JSON below. It also works from the browser for a signed-in Admin
(session cookie); set `HANDOFF_ALLOWED_ORIGIN` if you call it cross-origin.

## What the account page should show (the "continuity" moment)

So a judge lands and immediately thinks *"this is the same Acme I just qualified"*:

- A line under the title, or in the sidebar's *Handoff from lead team* block:
  **Originated from a qualified lead · Lead & Deal Workspace · Sep 18, 2026 · 3:42 PM** — linking to `opportunity.url`.
- Contacts and `sizing.users` / `sizing.locations` pre-populated; `need.primary_need` as the product line; `need.requirements` on the quote draft.
- An Activity entry: *"Qualified deal handed off from Lead & Deal Workspace"* with `handoff.requested_at` (replaces the hard-coded "from Total Expert" demo line).
- `qualification.*` is what sales established (`null` = not confirmed); `qualification.missing` lists what Ready to Contract still needs to ask.
- `need.summary` is a one-sentence narrative if you show one; `insights` are the commercial implications of the requirements (locations × users, integrations, replacement, timeline) — the only AI-derived content in the payload. Nothing in it is inferred pricing or product.

## Notes for the receiver

- Key the account on `customer.key` and upsert on it (see above), so a re-send
  refreshes one account rather than creating a second.
- `qualification.budget` is context the customer stated, never a price. No quote
  amount, package or discount is in this payload by design — pricing is yours.
- `qualification.missing` is what still has to be asked; `insights` are the
  commercial implications of the requirements (locations × users, integrations,
  replacement, timeline) and the only AI-derived content here.
- `opportunity.url` links back to the opportunity in this workspace, so a person
  on your side can always see where it came from.

## Shared visual language

Both apps use the same tokens so the transition is seamless. Copy `design/sales-engine-tokens.css` into your static assets (or mirror the values):

| Token | Value | Used for |
|---|---|---|
| navy / navy-light | `#1e3d8f` → `#2a52b8` | nav bar / sidebar gradient |
| primary | `#1d4ed8` | primary buttons, links, active states |
| background | `#f3f6fc` | page |
| card | `#ffffff` with `#e3e8f2` border, 14px radius | panels |
| foreground / muted | `#172246` / `#64708a` | text |
| success / warning / destructive | `#16a34a` / `#d97706` / `#dc2626` | Won / Needs attention / Lost |
| stage badges | tinted pill, `bg-{tone}/10 text-{tone}`, 6px radius | New · Contacted · Qualified · Quoted · Won · Lost |
| section labels | 11–12px, uppercase, letter-spaced, muted | ACCOUNT STRUCTURE / ACTIVITY |
| timestamps | `Today · 4:32 PM` · `Yesterday · 11:08 AM` · `Sep 15, 2026 · 3:20 PM` | all activity |

Logo: `public/brand/exp.png` (use the same file; on the dark nav apply `filter: brightness(0) invert(1)`).
Terminology: **Account** for the customer on your side, **Lead** on ours — the header line on your page bridges them ("Originated from a qualified lead").
