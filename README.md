# Experience Sales Engine — Lead & Deal Workspace

The front half of the Experience.com Sales Engine lifecycle, built as a real working application:

**Customer Inquiry → Opportunity → Qualification → AI Opportunity Intelligence → Quote Context → Continue to Contract**

Two experiences in one app:

- **Customer-facing lead intake** at `/inquire` — a prospect submits company, contact, users, interest and requirements; a lead is created instantly.
- **Internal Sales Engine workspace** at `/` (login required) — pipeline dashboard with stage counts, Needs Attention and Recent Activity; a per-lead workspace with Company info, Contacts, Activity timeline, Qualification, AI Opportunity Intelligence and Quote Readiness; and a **Continue to Contract** step that hands the quote context on for contracting (quote → approval → contract → e-signature → renewal).

Stack: Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui-style components on Radix · PostgreSQL (Supabase-compatible).

## Run it locally

Prerequisites: Node 20+, and PostgreSQL running locally (Postgres.app or `brew install postgresql@16` both work). Or point `DATABASE_URL` at a Supabase project instead — nothing in the code is Supabase-specific.

```bash
npm install
cp .env.example .env.local        # edit DATABASE_URL if your Postgres isn't postgres:postgres@localhost:5432
createdb sales_engine             # once
npm run db:setup                  # applies db/schema.sql (reading DATABASE_URL from .env.local), then seeds demo data
npm run dev                       # http://localhost:3000
```

Sign in as **sandhya@experience.com** / **demo1234** (Admin — the full lifecycle, including Ready to Contract), or as **sadhana@experience.com** / **demo1234** (Sales User — the lifecycle up to Scheduled Tasks).

Re-run `npm run db:seed` at any time to reset to a clean demo state (5 companies across New / Contacted / Needs Attention / Quoted / Won).

## Suggested demo path

1. Open `/inquire` and submit an inquiry as a customer.
2. Sign in at `/login` — the new lead is at the top of the pipeline with an AI-suggested next action.
3. Open it: log a call or note, fill in Qualification and set status to Qualified — the stage advances and **Continue to Contract** lights up.
4. Watch **AI Opportunity Intelligence** and **Quote Readiness** update as qualification fills in; then **Continue to Contract →**.
5. The Quote Context screen shows exactly what is handed over; continuing moves the opportunity to Ready to Contract and logs exactly what was handed over on the timeline.

## AI Opportunity Intelligence

The AI layer turns an unstructured customer inquiry into a grounded, validated, quote-ready opportunity. It is a small, bounded workflow (`src/lib/ai/orchestrator.ts`), not a chatbot and not a swarm of agents:

```
tools (read-only) ─► deterministic extraction (source of truth) ─► retrieval from the Sales Knowledge Base
      ─► 1. Opportunity Analyst   (Claude · grounded in the record, every claim cites a source)
      ─► 2. Solution Context      (Claude · grounded in the retrieved documents, every item cites a doc id)
      ─► 3. Readiness / Evaluator (deterministic guardrail + Claude review)
      ─► Opportunity Intelligence, saved on the lead ─► salesperson reviews ─► Continue to Contract →
```

- **Tools** (`src/lib/ai/tools.ts`): `get_opportunity`, `get_contacts`, `get_activities`, `get_qualification`, `search_knowledge`. Every call is traced and shown in the UI. All read-only — the AI never changes a stage, a qualification field or triggers the handoff; those stay behind the buttons a person clicks.
- **Sales Knowledge Base** (`src/lib/ai/knowledge/`): capability areas, integrations by industry, qualification guidance and quote-preparation rules, retrieved with a small explainable lexical retriever (`retrieval.ts`) so the AI can say *customer requires X → retrieved capability Y → consider Z when contracting*. No pricing, packages or tiers anywhere in it.
- **Deterministic layer** (`intelligence.ts`, `readiness.ts`) decides the facts: extracted deployment/integrations, qualification gaps, quote context, readiness, and **contradictions** between the inquiry and qualification (user count, primary need, decision maker). Claude interprets and explains; it cannot add facts.
- **Evaluator** removes anything that cites a source not on the record, cites a knowledge document that was not retrieved, contains a figure that appears nowhere in the record, or uses pricing/package language — and shows what it removed and why. Readiness for contracting is a ✓/⚠ checklist, never a vibe.
- **One-look chain**: every brief opens with "How the AI got here" — *Customer says → Knowledge retrieved → AI identifies → Gap (with the question to ask) → Contract readiness → Next action*. The seeded **Meridian Home Loans** lead ("connect our loan origination system so 1,200 loan officers across 85 branches get a review request at closing") walks it end to end: *Mortgage & real-estate systems* and *Reputation Management* documents retrieved → LOS integration required, 1,200 users and 85 branches confirmed → gap "Which loan origination system are you using — Encompass, or another LOS?" → Not ready → "Confirm which loan origination system (LOS) Elena Ruiz uses before Ready to Contract".
- **Output**: Customer Need · Evidence (sources used) · Relevant Product Context · Qualification Gaps (each with the question to ask) · AI check (potential conflicts) · Recommended Next Action · Quote Context · Contract Readiness, plus an expandable **AI process & evidence** panel with stages, tool calls, retrieved documents, record sources and the evaluator's conclusion. Process metadata only — never chain-of-thought.
- **Mode indicator**: the card is labelled **Claude · <model>** or **Deterministic**. With `ANTHROPIC_API_KEY` set the Claude stages run server-side; without it, or if the API fails or returns invalid JSON, each stage falls back to its deterministic result and says so.
- **Evals**: `npm run eval:ai` runs nine realistic opportunities (new, qualified, vague, conflicting, won, adversarial pricing request, enterprise HRIS chain, mortgage LOS chain…) and fails on any invented figure, pricing language, unresolvable citation, missed gap, missed contradiction or wrong readiness. `npm run eval:ai -- --claude` also runs them through Claude.

## The agent loop

Intelligence tells a salesperson what is true. The agent layer does something about it, and it is the same pipeline with one more stage on the end:

```
observe ─► understand ─► retrieve ─► decide ─► check readiness
       ─► ACT: choose the action · band its risk · draft the message
       ─► a person approves (or a green action runs on its own)
       ─► the customer replies ─► extract ─► update ─► re-evaluate ─► next action
```

- **Where it lives.** `src/lib/ai/act.ts` decides; `src/lib/ai/actions.ts` holds the five write tools and is the only place in the codebase where something other than a person's click changes an opportunity; `src/lib/ai/agent.ts` composes the loop. `orchestrator.ts` is untouched — deciding what is true and deciding what to do are separate stages and stay that way.
- **Where an action is stored.** On the activity timeline, as an ordinary row with `metadata.kind = "agent_action"` (goal, rationale, evidence, risk, draft message, state, delivery, trace). No new table, and no way for the agent's work to drift from the account history.
- **Risk bands.** **Green** — internal work and routine requests for a non-sensitive fact the customer already implied they would supply (which system, how many locations). Safe without a person. **Yellow** — anything needing interpretation or touching the relationship (decision maker, timeline, resolving a conflict). **Red** — commercial ground, budget included. Never automatic, whatever the caller asks: the rule is one function (`mayRunAutomatically`) checked at the point of execution, not at the button.
- **Grounded messages.** The draft goes through the same guardrail as the brief (`src/lib/ai/guard.ts`, shared with the evaluator): a figure that is not in the record, a price, a commitment, or a system name nobody mentioned, and Claude's draft is discarded for the deterministic wording — and the card says so.
- **Reading the reply.** Every extracted fact must carry a verbatim quote from the customer's message; a quote that is not in the reply is dropped before anything is written (`src/lib/ai/reply.ts`). So the CRM can only ever record what the customer actually said, and the workspace shows their own words beside each field it changed.
- **Sending.** `src/lib/email/provider.ts` is a two-implementation boundary. Configured (`EMAIL_PROVIDER=resend` + key + from address) a message is really sent and reported as **Sent**; unconfigured, the development provider stores it and it is reported as **Recorded — not delivered**. "Sent" is reserved for a live provider that confirmed.
- **Where it surfaces.** The Act tile on the chain and the Agent Action block in AI Intelligence; the AI actions card on Home (waiting for approval · safe to run · handled automatically · waiting for customer); agent rows in Scheduled Tasks; and AI preparation beside the week calendar, so a booked call arrives with its open questions already listed.
- **Evals.** `npm run eval:agent` — 39 checks over action selection, risk banding, message grounding, hallucination rejection, reply extraction, re-evaluation, auto-send safety and the deterministic fallback. `-- --claude` runs the Claude paths too. The nine intelligence evals are unchanged and still pass.

The seeded **BrightPath Realty** opportunity is the walkthrough: fully qualified, 9 checks with 8 passing, blocked only because the listing system was never named. The agent asks, the answer comes back "we use Bright MLS", and readiness, the gaps, the quote context and the next action all move on their own.

The header's primary action is **Continue to Contract →**: it verifies the minimum context, refreshes the intelligence so the Quote Context is final, marks the opportunity **Ready to Contract** on the timeline (auto-advancing New/Contacted to Qualified), and continues to the Quote Context screen, which shows exactly what is recorded. When information is missing the button becomes **Complete Qualification →** and jumps to the exact missing field. After pulling this change run `npm run db:schema` once (adds the `intelligence` column; idempotent).

## Where things live

| Area | Path |
|---|---|
| Schema | `db/schema.sql` — `companies`, `contacts`, `leads`, `activities`, `ai_deal_briefs`, `app_users` |
| Seed data | `db/seed.ts` |
| Data access | `src/lib/db.ts` (one Postgres boundary) and `src/lib/repo/*` |
| Server actions | `src/app/actions/*.ts` |
| Talk to Sales (customer) | `src/app/inquire/`, `src/components/inquire/`, `src/lib/inquiry-schema.ts` |
| Discovery-call booking | `src/lib/calendar/` (provider boundary, Google, local fallback, availability, booking), `src/app/api/availability/` |
| Dashboard | `src/app/(app)/page.tsx`, `src/components/dashboard/` |
| Lead workspace | `src/app/(app)/leads/[id]/`, `src/components/workspace/` |
| Quote handoff | `src/app/(app)/leads/[id]/quote/page.tsx` |
| AI workflow | `src/lib/ai/` — `orchestrator.ts`, `tools.ts`, `claude.ts`, `knowledge/`, `intelligence.ts`; evals in `evals/ai-intelligence/` |

## Team, ownership and coverage

Every lead has an **Owner**. New inquiries are routed automatically (`src/lib/routing.ts`): the team member who covers that industry gets it ("Assigned to Sandhya (Dental specialist)" on the timeline); if nobody covers it, whoever has the fewest open deals does. Any team member can hand a deal to anyone else from the **Owner** control in the lead header, with an optional reason ("covering while Sandhya is on leave") — the change is logged so coverage is always visible. The sidebar's **Team** section filters the pipeline to *My leads*, a colleague's book, or *Unassigned*.

Demo team (all password `demo1234`): sandhya@ (Admin), sadhana@ and marcus@experience.com (Sales User).

## Roles and access

Two roles, one boundary, held in `app_users.role`:

| | Sales User | Admin |
| --- | --- | --- |
| Inquiries, pipeline, opportunity workspace, contacts, activity, qualification, AI Deal Brief, Scheduled Tasks | yes | yes |
| Ready to Contract, the quote context review, the handoff API | no | yes |

A Sales User owns the whole front half: they qualify the opportunity and the AI brief still tells them when qualification is complete — they simply do not perform the handover. Their nav ends at Scheduled Tasks, their Home has no contract card, and handoff to-dos do not appear on their list.

The rule lives in one predicate (`canAccessContract`, `src/lib/roles.ts`) that both halves read, and it is **enforced on the server, not just in the UI** (`src/lib/authz.ts`): the pages redirect, the server actions refuse, the handoff API answers 403, and `src/proxy.ts` refuses the request before it reaches any of them. Typing the URL, replaying the action or curling the endpoint all get the same answer as the hidden button. The role is read from the database on each request, so changing someone's role takes effect immediately and no edited cookie can grant it.

## Talk to Sales and discovery-call booking

The customer-facing entry point is **Talk to Sales** (`/inquire`; `/talk-to-sales` redirects there). Required: company, full name, work email, phone, industry (select), number of users. Optional: what they're interested in, what they're looking to achieve, additional information. Phone is required because it is how the first contact attempt actually happens; the interest select is not, since many inquiries describe the need in their own words instead — when neither is given, the AI brief opens with that as the qualification gap. Every field is controlled and validated inline against the same zod schema the server uses (`src/lib/inquiry-schema.ts`) — an invalid email shows its message under the field and nothing else changes; no reload, no reset.

On the confirmation page the customer can book a **discovery call** from the sales team's real availability:

- `src/lib/calendar/` is the boundary. `GoogleCalendarProvider` reads free/busy for the configured rep calendars and creates the event through the Google Calendar API with a service account (plain REST, like Google sign-in). `LocalAvailabilityProvider` is the development fallback — business hours minus bookings already in this database — and is labelled **"Demo availability — Google Calendar not configured"** to the customer and the sales side. The app never claims Google is connected when it isn't.
- Slots are the team's business hours (`SALES_TIMEZONE`, `SALES_HOURS`, `DISCOVERY_SLOT_MINUTES`) where at least `SALES_MIN_FREE_REPS` reps are free. The customer only ever sees times — never who is free or any event detail — shown in **their** time zone (detected in the browser) with the team's zone noted.
- Booking re-verifies the slot against live free/busy, assigns the lead's owner if free (else the first free rep), creates the event with the customer and rep as attendees (`sendUpdates=all`), and stores the appointment on the opportunity as a follow-up with the calendar details (`metadata.calendar`: event id, link, rep, customer time zone, whether invitations went out). The workspace header, timeline and AI next action all read that follow-up.
- Without domain-wide delegation Google refuses attendee lists from service accounts; the app then creates the event on the team calendar without attendees and tells the rep to send the invite.

Configuration is in `.env.example` (service account key, `SALES_CALENDARS`, `GOOGLE_CALENDAR_IMPERSONATE`, `SALES_BOOKING_CALENDAR`).

## Sign in

Email + password only (`app_users`, bcrypt). There is no self-service sign-up and no third-party sign-in, so the only people who can get in are accounts an administrator created. Three roles — Sales Employee, Sales Manager, Admin (`src/lib/roles.ts`). Customers never sign in: they use `/inquire`.

## Where leads come from

- **Customer form** — `/inquire` (localhost:3000/inquire). The public page a prospect fills in; in production it is linked from the Experience.com website.
- **Internal** — the **+ New Lead** button, for phone-in or manually captured inquiries.
- **Other channels** — `POST /api/inquiries` with header `X-Inbound-Key: <INBOUND_API_KEY>`. Any system that captures interest — a website chat agent, a partner landing page, an automation — can create leads here. Body: `companyName, contactName, workEmail, phone?, numberOfUsers, interest, industry?, requirements, additionalInfo?, source?`. Replies `201 { leadId, companyId, companyMatched, leadUrl }`. Same de-dup and AI brief as the form; the timeline records the source (e.g. "Lead created from API (branvidia-chat)").

All three ask for the prospect's **industry**, which the pipeline shows on each row and filters by from the sidebar.

## The handoff

This application owns the lifecycle up to **Ready to Contract**. Contracting
itself — quote, approval, contract, e-signature, document storage, renewal — is
a separate application and is deliberately not duplicated here.

**Continue to Contract** on a qualified opportunity verifies the minimum
context, refreshes the AI intelligence so the quote context is final, moves the
opportunity to Ready to Contract and records exactly what was handed over on the
timeline. Nothing else has to be running for that to work.

The context itself is published as one read-only endpoint:

```
GET /api/handoff/{leadId}          # an Admin session, or X-Sales-Engine-Key: $HANDOFF_API_KEY
```

It returns the schema-2.0 payload — company, every contact, user count,
interest, requirements, qualification and the AI insights — and no quote
amount, package or discount: pricing belongs to whoever builds contracting, and
the customer's budget travels as context only. Contract:
**[docs/QUOTE_HANDOFF.md](docs/QUOTE_HANDOFF.md)**.

## Scope boundary

This module owns everything from inquiry through the Ready to Contract handoff (Customer Inquiry → Opportunity → Qualification → AI Opportunity Intelligence → Quote Context). Package recommendation, quote versioning, pricing/discount rules, approvals, contracts, e-signature, document storage and renewals belong to the separate Quote/Contract application and are intentionally not duplicated here; the handoff screen is the integration point, and it passes company, all contacts, user count, interest, requirements and qualification so contracting can consume them.
