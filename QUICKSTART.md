# Experience Sales Engine — Lead & Deal Workspace · Quick start

Next.js (React + TypeScript) · Tailwind + shadcn/ui · Postgres. One application, one
command, one link: **http://localhost:3000**. Nothing else has to be running.

## You need
- Node.js 20 or newer (`node --version`)
- PostgreSQL 14 or newer running locally (`brew install postgresql@16 && brew services start postgresql@16` on a Mac)

## Set up (once, ~2 minutes)

```bash
cd sales-engine

# 1. Dependencies
npm install

# 2. Database
createdb sales_engine
cp .env.example .env.local
#    Open .env.local and set DATABASE_URL to your Postgres, e.g.
#    DATABASE_URL=postgres://<your-mac-username>@localhost:5432/sales_engine
#    Optional: ANTHROPIC_API_KEY=sk-ant-…  → AI Opportunity Intelligence runs on Claude
#    (without it the same workflow runs deterministically and the badge says "Deterministic")
npm run db:setup                  # applies the schema and seeds demo data
```

## Run

```bash
npm run dev
```

Wait for `▲ Next.js … http://localhost:3000`, then open **http://localhost:3000**. Ctrl+C stops it.

## Try the flow

| Step | Where |
|---|---|
| Customer submits an inquiry (and can book a discovery call) | http://localhost:3000/inquire |
| Sign in — `sandhya@experience.com` / `demo1234` (Admin: full lifecycle) or `sadhana@experience.com` / `demo1234` (Sales User: stops at Scheduled Tasks) | http://localhost:3000/login |
| New inquiry appears at the top of the Sales Pipeline and in the 🔔 | Sales Pipeline |
| Open it: Contacts · Activity · Qualification · **AI Intelligence** (chain, evidence, gaps, readiness, "AI process & evidence") | Lead workspace |
| Best AI example: **Meridian Home Loans** → AI Intelligence tab | Sales Pipeline |
| Header button **Continue to Contract →** (or **Complete Qualification →** while data is missing). Admin only | Lead workspace |
| Quote Context review → Continue → the opportunity moves to **Ready to Contract**, with the handed-over context on its timeline | Ready to Contract |

The contract side of the lifecycle (quote → approval → contract → e-signature → renewal)
is a separate module built by another contributor. This application ends at the handoff:
it records the quote context and hands it on. `docs/QUOTE_HANDOFF.md` is the contract.

## Roles

`app_users.role` is either `admin` or `sales`. A Sales User works the lifecycle up to
Scheduled Tasks; an Admin additionally has Ready to Contract and the quote handoff.
Seeded: Sandhya is Admin, Sadhana and Marcus Lee are Sales Users.

## Checks
- `npm run eval:ai` — 9 realistic opportunities; fails on any invented figure, pricing language, unresolvable citation, missed gap/conflict or wrong readiness. Add `-- --claude` to run them through Claude too.
- `npm run lint` · `npm run build`

## If something doesn't start
- `address already in use` on 3000 → `lsof -nP -iTCP:3000 -sTCP:LISTEN`, then `kill <PID>` and rerun.
- `connection refused … 5432` → Postgres isn't running, or `DATABASE_URL` in `.env.local` is wrong.
- Login page loads but sign-in fails → run `npm run db:seed` to create the demo users.
- **Ready to Contract** missing from the left nav → you are signed in as a Sales User. That entry and the quote handoff are Admin-only, enforced in the pages, the server actions, the APIs and `src/proxy.ts`. Sign in as `sandhya@experience.com`.

Handoff contract: `docs/QUOTE_HANDOFF.md` · Full details: `README.md`
