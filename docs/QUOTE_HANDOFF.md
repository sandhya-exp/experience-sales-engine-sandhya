# Guided Selling handoff — integration contract

This is the boundary between the two halves of the Experience.com Sales Engine:

```
Lead & Deal Workspace (Next.js, :3000)                                   Guided Selling module (FastAPI, :8001)
Customer Inquiry → Opportunity → Qualification → AI Opportunity Intelligence → Quote Context → [Continue to Guided Selling →] → Quote → Approval → Contract → E-signature → Renewal
```

When a rep clicks **Continue to Guided Selling →** on a qualified opportunity, the Lead & Deal Workspace:

1. Assembles the quote context (payload below) — the same opportunity, customer, contacts, qualification, requirements and AI insights.
2. `POST`s it to the Guided Selling module (**push**).
3. Moves the opportunity to the **Guided Selling** stage and records a timestamped handoff activity.
4. Opens the Guided Selling page with the module embedded on that opportunity.

If the POST isn't available yet, steps 3–4 still happen; the module can **pull** the identical payload with `GET /api/handoff/{lead_id}`.

## One customer, never duplicated

`customer.key` is stable on both sides: the company's email domain (`acme.com`), or a slug of the name when the domain is a free-mail provider. **Upsert on `customer.key`.** A second inquiry from the same company arrives with the same key and a new `opportunity` — it must attach to the existing account, exactly as renewals do on your side.

## Push — what we send you

```
POST {QUOTE_WORKSPACE_URL}/api/handoffs
Content-Type: application/json
X-Sales-Engine-Key: <shared HANDOFF_API_KEY>
```

```json
{
  "schema_version": "2.0",
  "source": "lead-deal-workspace",
  "handoff": { "requested_at": "2026-09-19T10:42:00Z", "requested_by": "Sandhya", "resend": false },
  "opportunity": { "id": "<lead uuid>", "stage": "qualified", "owner": "Sandhya", "created_at": "…", "qualified_at": "…", "url": "http://localhost:3000/leads/<lead uuid>" },
  "customer": { "key": "summitcare.health", "id": "<company uuid>", "name": "Summit Care Clinics", "domain": "summitcare.health", "industry": "Healthcare" },
  "need": {
    "summary": "Summit Care Clinics wants patient satisfaction surveys across 4 clinics for 30 users.",
    "primary_need": "Patient satisfaction surveys",
    "requirements": "Patient satisfaction surveys across 4 clinic locations.",
    "additional_info": null,
    "integrations": []
  },
  "sizing": { "users": 30, "locations": "4 clinics" },
  "qualification": { "status": "qualified", "budget": "$15k–20k / year", "decision_timeline": "Within 3 months", "decision_maker": "Dr. Anil Mehta, Medical Director", "current_solution": "Paper surveys", "missing": [] },
  "contacts": [{ "name": "Dr. Anil Mehta", "email": "anil@summitcare.com", "phone": "+1 …", "title": "Medical Director", "is_primary": true }],
  "activity": [{ "type": "call", "body": "Discovery call — …", "actor": "Sandhya", "occurred_at": "…" }],
  "insights": ["Multi-location deployment across 4 clinics with 30 users — the quote should account for both the locations and the user quantity."],
  "links": { "handoff_api_url": "http://localhost:3000/api/handoff/<lead uuid>" }
}
```

### Mapping from schema 1.x → 2.0 (what was removed and why)

| v1.x field | v2.0 home | Note |
|---|---|---|
| `account.*` | `customer.*` | renamed; `lead_workspace_id` → `id` |
| `deal.lead_workspace_id`, `deal.stage`, `deal.owner`, `deal.created_at`, `deal.qualified_at` | `opportunity.*` | renamed |
| `deal.number_of_users` **and** `quote_context.users` | `sizing.users` | was sent twice |
| `quote_context.deployment` | `sizing.locations` | |
| `deal.interest` **and** `quote_context.primary_need` | `need.primary_need` | was sent twice |
| `deal.requirements`, `deal.additional_info` | `need.requirements`, `need.additional_info` | |
| `ai_brief.summary` **and** `ai_brief.customer_need` | `need.summary` | identical strings sent twice |
| `quote_context.integrations` | `need.integrations` | |
| `deal.qualification.{budget,decision_timeline,decision_maker,current_solution}` **and** `quote_context.{…}` | `qualification.*` | was sent twice |
| `deal.qualification_status` | `qualification.status` | |
| `readiness.missing` **and** `ai_brief.missing_info` | `qualification.missing` | was sent twice; `readiness.passed/total/ready` dropped (implied by the handoff) |
| `contacts` **and** `quote_context.primary_contact` / `contacts_count` | `contacts` (`is_primary` flag) | was sent twice |
| `ai_brief.quote_implications` | `insights` | the one AI output the downstream module uses |
| `ai_brief.next_action`, `ai_brief.key_facts`, `ai_brief.generated_at` | — | rep-facing / legacy; not needed downstream |
| `quote_context.customer/industry/key_requirements` | — | duplicates of `customer` / `need.requirements` |
| `recent_activity` (10, incl. system events) | `activity` (5 human touchpoints) | status changes, assignments and system notes dropped |
| `links.lead_workspace_url` | `opportunity.url` | |


`deal.stage` is always `qualified` at handoff. **Idempotency:** a rep can pull a deal back to Qualified, refine it and send it again — then `handoff.resend` is `true` and `deal.lead_workspace_id` is unchanged. Upsert the deal on `deal.lead_workspace_id` (stored as `origin.lead_id` below); never create a second deal for the same lead. `type` values: `call | email | message | note | status_change | qualification_change`. Anything nullable may be `null`.

**Respond** `200`/`201` with, optionally, where the account now lives — we'll send the user straight there:

```json
{ "account_url": "http://127.0.0.1:8001/accounts/acme.com" }
```

Any non-2xx (or no endpoint yet) is fine: we record the handoff as *pending* and open the default URL below, and you pull the payload on load.

## Pull — fetching it yourself

```
GET {LEAD_WORKSPACE_URL}/api/handoff/{lead_id}
X-Sales-Engine-Key: <shared HANDOFF_API_KEY>
```

Returns the same JSON. The `lead_id` arrives on your URL (`?lead_id=…`). Also works from the browser for a signed-in Sales Engine user (cookie), with CORS allowed for `QUOTE_WORKSPACE_URL`.

## Where we send the user

Default: `{QUOTE_WORKSPACE_URL}/?lead_id={leadId}&customer_id={accountKey}`
(Override with `QUOTE_ACCOUNT_URL_TEMPLATE` in the Lead & Deal `.env.local`.)

The Guided Selling module (`modules/guided-selling`) reads those query parameters on load: a queued
handoff opens the **Lead handoff** inbox, an accepted one opens its **Customer 360**. The
Guided Selling page embeds the module with `&embed=1` (module shell without its own sidebar).

## What the account page should show (the "continuity" moment)

So a judge lands and immediately thinks *"this is the same Acme I just qualified"*:

- A line under the title, or in the sidebar's *Handoff from lead team* block:
  **Originated from a qualified lead · Lead & Deal Workspace · Sep 18, 2026 · 3:42 PM** — linking to `opportunity.url`.
- Contacts and `sizing.users` / `sizing.locations` pre-populated; `need.primary_need` as the product line; `need.requirements` on the quote draft.
- An Activity entry: *"Qualified deal handed off from Lead & Deal Workspace"* with `handoff.requested_at` (replaces the hard-coded "from Total Expert" demo line).
- `qualification.*` is what sales established (`null` = not confirmed); `qualification.missing` lists what Guided Selling still needs to ask.
- `need.summary` is a one-sentence narrative if you show one; `insights` are the commercial implications of the requirements (locations × users, integrations, replacement, timeline) — the only AI-derived content in the payload. Nothing in it is inferred pricing or product.

## The receiver (implemented)

`modules/guided-selling/app/inbound.py` maps this payload onto the Guided Selling module's existing
`HandoffLead`, and `POST /api/handoffs` (in `modules/guided-selling/app/main.py`) upserts it into the
handoff inbox by id (`se-{opportunity.id}`), so a re-send never creates a second entry.

| Payload | HandoffLead |
|---|---|
| `opportunity.id` | `id` = `se-{id}` |
| `customer.key` | `customer_id` — Customer 360 is keyed on it; re-accepting refreshes the same account |
| `customer.name` | `company` |
| — | `source_crm` = `Experience.com` (native intake); the module applies its own default agreement and catalog fallback |
| `need.summary` (+ users / locations / first insight when not already in the summary) | `why_qualified` |
| `qualification.budget` | `budget_context` (context only — never the quote price); `quote_amount` is always `To be quoted` until Guided Selling prices it |
| `qualification.missing` | `gaps` |
| `contacts[]` (`title`→`role`; signer = the contact matching `qualification.decision_maker`) | `contacts` |

Everything from **Accept handoff** onward is the module's own flow, unchanged.

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
