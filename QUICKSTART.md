# Experience Sales Engine — Lead & Deal Workspace · Quick start

Next.js (React + TypeScript) · Tailwind + shadcn/ui · Postgres. The contract module
(Quote → Approval → Contract → E-signature → Renewal) is included in `modules/guided-selling`
and starts with the same command. Open everything from **one link: http://localhost:3000**.

## You need
- Node.js 20 or newer (`node --version`)
- PostgreSQL 14 or newer running locally (`brew install postgresql@16 && brew services start postgresql@16` on a Mac)
- Python 3.11+ for the Guided Selling module (`python3 --version`)

## Set up (once, ~3 minutes)

```bash
cd sales-engine

# 1. Dependencies
npm install
python3 -m venv modules/guided-selling/.venv
modules/guided-selling/.venv/bin/pip install -r modules/guided-selling/requirements.txt

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

Wait for `[workspace] ▲ Next.js … http://localhost:3000`, then open **http://localhost:3000**. Ctrl+C stops both servers.

## Try the flow

| Step | Where |
|---|---|
| Customer submits an inquiry (and can book a discovery call) | http://localhost:3000/inquire |
| Sign in — `sandhya@experience.com` / `demo1234` (Admin: full lifecycle) or `sadhana@experience.com` / `demo1234` (Sales User: stops at Scheduled Tasks) | http://localhost:3000/login |
| New inquiry appears at the top of the Sales Pipeline and in the 🔔 | Sales Pipeline |
| Open it: Contacts · Activity · Qualification · **AI Intelligence** (chain, evidence, gaps, readiness, "AI process & evidence") | Lead workspace |
| Best AI example: **Meridian Home Loans** → AI Intelligence tab | Sales Pipeline |
| Header button **Continue to Contract →** (or **Complete Qualification →** while data is missing). Admin only | Lead workspace |
| Quote Context review → Continue → the same customer appears in **Ready to Contract**: Accept handoff → Customer 360 → Contract → Signing → Renewal | Ready to Contract |

## Roles

`app_users.role` is either `admin` or `sales`. A Sales User works the lifecycle up to
Scheduled Tasks; an Admin additionally has Ready to Contract and the handoff into the
contract module. Seeded: Sandhya is Admin, Sadhana and Marcus Lee are Sales Users.

## Checks
- `npm run eval:ai` — 9 realistic opportunities; fails on any invented figure, pricing language, unresolvable citation, missed gap/conflict or wrong readiness. Add `-- --claude` to run them through Claude too.

## If something doesn't start
- `address already in use` on 8001 → another copy of the contract module is running; `lsof -nP -iTCP:8001 -sTCP:LISTEN`, then `kill <PID>` and rerun.
- `connection refused … 5432` → Postgres isn't running, or `DATABASE_URL` in `.env.local` is wrong.
- Login page loads but sign-in fails → run `npm run db:seed` to create the demo users.
- **Ready to Contract** missing from the left nav → you are signed in as a Sales User. That entry, the quote handoff and the contract module behind it are Admin-only, enforced in the pages, the server actions, the APIs and `src/proxy.ts`. Sign in as `sandhya@experience.com`.

Handoff contract: `docs/QUOTE_HANDOFF.md` · Full details: `README.md`
