# Experience Sales Engine — Lead & Deal Workspace

An independent, end-to-end Sales Engine build for the Experience.com SRP Build Intake competition: a customer-facing lead intake form feeding an internal sales workspace that carries a deal from first inquiry through qualification, quoting, negotiation and outcome — with an AI layer that reads the opportunity, reasons over it with tools, and drafts the next step instead of a bolt-on chatbot.

```
Customer Inquiry → Lead → Contacted → Qualified → Quote → Approval → Won / Lost
```

This is my own, independently built implementation of the Lead & Deal Management portion of the Sales Engine. It does not include or depend on any other contributor's module.

## Technology

- **Next.js 16** (App Router, server components + server actions), **React 19**, **TypeScript**
- **Tailwind CSS v4**, hand-built component library in the shadcn/ui style on top of **Radix UI** primitives
- **PostgreSQL** via `pg` — no ORM, hand-written SQL, no separate query/API layer duplicating the app
- **Claude (Anthropic)** for opportunity analysis, requirement extraction, next-action reasoning and quote-narrative drafting, called through a small typed client (`src/lib/ai/claude.ts`) with **deterministic, rule-based fallbacks** for every AI feature so the app is fully usable with no API key configured
- A lexical (TF-IDF-style, tag-boosted) **retrieval** layer over an in-repo Sales Knowledge Base — grounding the AI in written playbook content, not a hosted vector database
- **Google Calendar API** for live availability and real meeting creation
- Plain **REST route handlers** (`src/app/api/**`) for the customer-facing intake and the read-only deal handoff
- Zod for input validation, date-fns, sonner for toasts, bcryptjs for password hashing

Nothing here is invented for the README: this is the actual dependency list in `package.json`, and it is deliberately short — no vector-database client, no FastAPI/Python service, no video-conferencing SDK.

## Run it locally

```bash
npm install
cp .env.example .env.local        # set DATABASE_URL, and ANTHROPIC_API_KEY to enable live AI (optional)
createdb sales_engine
npm run db:setup                  # creates schema, then seeds demo data
npm run dev
```

Visit `http://localhost:3000`.

**Demo login:** `sandhya@experience.com` / `demo1234` (Admin — full access to every stage, every workspace and Reports).

Optional Google Calendar setup for live availability and Meet-linked scheduling:

```bash
npm run gcal:check     # verify service-account credentials are wired up
npm run gcal:setup     # create the shared team calendar if it doesn't exist yet
```

Without Google Calendar configured, scheduling falls back to a clearly labeled local availability provider so the flow still works end to end.

## 1. Product

The Sales Engine covers the full front-to-mid lifecycle a deal actually goes through:

**Lead → Qualification → Opportunity → Quote → Negotiation/Requote → Approval → Won/Lost**

- **Lead intake** (`/inquire`) — a public form (company, contact, work email, phone, seat count, interest, requirements, optional additional info) that creates a lead directly in the pipeline; no separate "inbox" step.
- **Pipeline** (`/pipeline`, and the Home dashboard) — every lead grouped by status (New, Contacted, Qualified, Quoted, Won, Lost), with search/filter and a single-stage focus view.
- **Deal workspace** (`/leads/[id]`) — the central page for one company/deal: company + multiple contacts, qualification record, activity timeline, communication actions, quotes, and the AI Deal Brief, all in one place rather than split across separate screens.
- **Activity & communication** — calls, emails, messages, notes and status changes are all first-class activity records with a full, chronological timeline.
- **Scheduling** — a week-view calendar (`/schedule`) for discovery calls, booked against real availability.
- **Quoting** — a CPQ-style line-item quote editor with discount rules, an approval chain, versioning/requoting, and an AI-drafted covering narrative.
- **Reporting** (`/reports`) — pipeline, revenue, conversion and win/loss visibility computed live from the same activity data.
- **Handoff to Contract** — a single "Create Quote" / "Continue to Contract" action and a read-only `/api/handoff/[leadId]` endpoint expose everything a downstream quote-to-contract system needs, without this codebase implementing contracts, e-signature, document storage or renewals itself.

## 2. AI / Agentic Architecture

The AI here is not a textbox bolted onto a CRM. It's a grounded orchestration pipeline that reasons over one opportunity's actual record, backed by tools and a knowledge base, with mechanical guardrails checking every output before it's shown — and a deterministic fallback path for every single AI feature, so the product never depends on the model being available.

**Opportunity/Sales Agent orchestration** (`src/lib/ai/orchestrator.ts`) runs in stages for every Deal Brief:

1. **Tools** (`src/lib/ai/tools.ts`) assemble the opportunity's actual CRM record — company, contacts, qualification answers, activity history — into a structured `OpportunityRecord`, with a full `ToolTrace` of what was pulled.
2. **Deterministic extraction** pulls out hard facts (seat counts, stated interest, qualification fields) that don't need a model to find, so the AI layer is reasoning on top of known facts rather than re-deriving them.
3. **Knowledge retrieval** (`src/lib/ai/knowledge/retrieval.ts`) — a lightweight, dependency-free lexical retriever (TF-IDF-style scoring with tag boosting) searches an in-repo Sales Knowledge Base of playbook content and returns the passages relevant to this specific opportunity, so the model is reasoning with retrieved context rather than from memory alone.
4. **Opportunity Analyst** (Claude) reads the record, the extracted facts and the retrieved knowledge, and produces a structured summary of the customer's need.
5. **Solution Context** (Claude) turns that summary into quote-relevant context — what's being asked for, what isn't yet answered.
6. **Readiness / Evaluator** — a deterministic layer plus a Claude review pass checks the brief for missing qualification information and flags what's still needed before a quote can go out.

The output is a single **AI Deal Brief** per opportunity: a plain-language summary of the customer's requirement, what's missing, and a suggested next action — reasoning that's traceable back to real record data and retrieved knowledge, not a free-floating chat response.

**The agent loop** (`src/lib/ai/agent.ts`, deciding in `src/lib/ai/act.ts`, acting in `src/lib/ai/actions.ts`) goes one step further than analysis: it can propose and, within limits, take actions.

- Every candidate action is assigned a risk band — **GREEN** actions (e.g. logging an internal note) may run automatically; **YELLOW/RED** actions (anything customer-facing) require a human to review and approve before anything goes out. `mayRunAutomatically` is the single gate this passes through.
- **Grounding guardrail** (`src/lib/ai/guard.ts`) — shared by the agent's drafted messages and the quote narrative — mechanically rejects a draft that promises an outcome or timeline, invents a proper noun not present in the record, or uses a number that doesn't appear anywhere in the customer's own words or the CRM data. This runs after the model responds, independent of the prompt, so it can't be argued around by a bad completion.
- **Reply extraction** (`src/lib/ai/reply.ts`) requires any quote the AI attributes to the customer to be a verbatim substring of what the customer actually wrote — no paraphrased "customer said" claims.
- **Evidence-grounded reasoning**: every AI-facing feature is built on the same principle — say only what's in the record, and mechanically check that afterward rather than trusting the prompt.
- **Deterministic fallback**: every AI surface (Deal Brief, agent actions, quote narrative) has a non-AI code path that runs whenever Claude isn't configured or a draft fails its guardrail check, so the app degrades to a rules-based version of the same feature rather than failing.
- **AI evaluation tests** — two scripted eval suites run outside the UI: `npm run eval:ai` runs 9 realistic opportunity scenarios through the full orchestration pipeline, and `npm run eval:agent` runs 39 checks against the agent loop's action and message drafting.

## 3. Automation

- **Next-action recommendation** — every Deal Brief ends with a specific suggested next step, not just a summary.
- **Customer response analysis** — the agent loop reads new customer communication and proposes a follow-up action grounded in what was actually said.
- **SLA handling** (`src/lib/sla.ts`) — a two-stage, wall-clock-based rule: a lead with no response inside the configured window (`SLA_RESPOND_HOURS`) surfaces a reminder; past a second window (`SLA_REASSIGN_HOURS`) it's flagged for reassignment. It's a pure function evaluated over the timeline on read, not a background job.
- **Scheduling against real availability** — the booking flow reads live Google Calendar availability (or a clearly labeled local fallback) so a rep can't double-book a slot.
- **Quote / requote workflow** — sending a quote back for changes, and creating a new version, are both first-class actions that this system automates the bookkeeping for.
- **Approval workflow** — a discount past a configured threshold routes automatically to a manager, and past a higher threshold to an admin as well; the app enforces this server-side, not just in the UI.
- **Human approval before anything customer-facing** — every AI-drafted message, every AI-drafted quote narrative and every YELLOW/RED-risk agent action is a draft sitting in front of a person until they approve or edit it. Nothing AI-generated is sent without a human in the loop.

## 4. Quote / Sales Workflow

- **Line-item quote editor** — a CPQ-style editor (not a single "amount" field): per-line description, quantity, list unit price and line discount, with net unit price and net total computed live.
- **Header-level commercial terms** — start date, contract term (months), an auto-derived end date, an additional (quote-level) discount, and tax.
- **Discount / approval rules** (`src/lib/quotes/rules.ts`) — a two-tier chain: a line or quote past `QUOTE_DISCOUNT_APPROVAL_PCT` (default 15%) needs a manager; past `QUOTE_DISCOUNT_ADMIN_PCT` (default 25%) needs an admin as well, cumulative — the UI and the server agree on exactly the same numbers.
- **Quote versioning / requoting** — a manager or admin can send a quote back with a note instead of approving it; the rep revises and resubmits, and every version is kept on the timeline.
- **AI-generated quote narrative** (`src/lib/ai/narrative.ts`) — a short, second-person covering note drafted from the customer's stated requirement and the exact line items on the quote. It is only allowed to say three things — what the customer asked for, what's on the quote, and what happens next — and a mechanical check discards any draft that promises an outcome, mentions or justifies a discount, names something not in the record, or uses an invented figure. A deterministic version (assembled from the same record, no model) is always available and is what's shown if Claude isn't configured or a draft is rejected.
- **Quote status and lifecycle** — draft, sent, changes-requested, approved/won, tracked per version.
- **Audit / timeline history** — every quote creation, edit, change request and status change is recorded as an activity, visible on the same deal timeline as calls, emails and notes.

## 5. Reporting

`/reports` computes, live from the same `activities`/`leads` data every other page reads (no separate warehouse or modeled numbers):

- Pipeline value and stage funnel
- Revenue by month
- Conversion / win-loss breakdown
- Sales cycle time

Reports render in-app and export via the browser's own print dialog (`/reports/print` + `window.print()`) rather than a server-side PDF library — no PDF-generation dependency in the codebase, so the README doesn't claim one.

## 6. Scheduling

- **Discovery-call booking** against real availability, shown as a week-view calendar (`/schedule`) with office-hours shading, an overdue/no-activity warning state, and a link from every booked slot straight into the deal workspace.
- **Google Calendar integration** — when configured, availability is read live from Google Calendar and booking a call creates a real Google Calendar event with a real Google Meet link generated by the Calendar API (`conferenceData.createRequest`). A `LocalAvailabilityProvider` fallback (explicitly labeled as demo availability in the UI) is used when Google Calendar isn't configured, so scheduling still works end to end.
- **Zoom / Microsoft Teams** — a rep can paste a Zoom or Teams meeting link when booking a call, and it's stored and shown on the event. This is not a live Zoom or Teams API integration — no meeting is created through either service — and this README does not claim otherwise.

## 7. Where things live

| Area | Route |
| --- | --- |
| Customer lead intake | `/inquire` |
| Home / dashboard | `/` |
| Pipeline (stage board) | `/pipeline` |
| Deal workspace | `/leads/[id]` |
| Quote line editor | `/leads/[id]/quote` |
| Quotes overview | `/quotes` |
| Companies | `/companies` |
| Activity | `/activity` |
| Schedule | `/schedule` |
| Tasks | `/tasks` |
| Reports | `/reports` (print view at `/reports/print`) |
| Sign in | `/login` |

API surface: `/api/inquiries` (lead intake), `/api/handoff/[leadId]` (read-only deal handoff), `/api/availability` and `/api/availability/rep` (scheduling), `/api/activity/recent`, `/api/notifications` and `/api/notifications/seen`.

## Roles and access

Three roles (`src/lib/roles.ts`), enforced server-side (`src/lib/authz.ts`), not just hidden in the UI:

- **Sales Employee** — works leads end to end: contacts, activity, qualification, and drafts quotes for approval.
- **Sales Manager** — everything a Sales Employee can do, plus approving and releasing quotes to the customer, and visibility across the team's pipeline and reports.
- **Admin** — everything a manager can do, plus the contract handoff (Ready to Contract) and reassigning who a lead is owned by.

## The handoff

The deal workspace's primary action is **Create Quote** (or **Open Quote**, once one exists) — a single, clearly-labeled entry point rather than this codebase reaching into contract, e-signature, document-storage or renewal territory. A read-only `GET /api/handoff/[leadId]` endpoint exposes the company, contacts, qualification record and quote data a downstream quote-to-contract system needs to pick the deal up, without this module owning or duplicating that functionality.

## Scope boundary

This build is Lead & Deal Management: intake, pipeline, qualification, activity, scheduling, AI deal intelligence, and quoting up through approval. It deliberately stops at the handoff — contract generation, e-signature, document storage and renewals are out of scope for this module and are not implemented here.

## Suggested demo path

1. Submit a lead at `/inquire` — company, contact, seat count, what you're interested in, and a couple of sentences of requirements.
2. Open the new lead from the Pipeline or Home dashboard.
3. Open the **AI Deal Brief** — see the summarized requirement, what's still missing, and the suggested next action, grounded in what was actually submitted.
4. Log a call or note, then check the agent's suggested next action update in response.
5. Move the lead to Qualified, filling in the qualification panel.
6. Click **Create Quote** — build a line-item quote, apply a discount that crosses the manager threshold, and watch the approval requirement appear live.
7. Draft the AI quote narrative, and see it grounded strictly in the requirement and the line items just entered.
8. Submit the quote; sign in as a manager to approve it or send it back with a note for a new version.
9. Move the deal to Won or Lost and check the timeline and Reports for the resulting activity.
