> Part of the Experience Sales Engine. The Lead & Deal Workspace (repo root) pushes the quote
> context to `POST /api/handoffs` here on **Continue to Guided Selling** and embeds this app on its Guided Selling page
> (`/?lead_id=…&customer_id=…&embed=1`). See `../../docs/QUOTE_HANDOFF.md`.

# Experience.com Sales Engine

Python **FastAPI** backend + **React / TypeScript / Tailwind / shadcn/ui** frontend for the post-quote half of the sales engine:

**quote / deal → contract → signed document → renewal**

Lead intake stays with the other team (Encompass, BytePro, Total Expert, AgencyZoom). This service starts after a deal is qualified.

## Run

```bash
cd ~/Desktop/experience-sales-engine

# Frontend
export PATH="$PWD/.tools/node/bin:$PATH" # project-local Node, if Node is not global
cd frontend
npm install
npm run build
cd ..

# Backend + built React app
source .venv/bin/activate
uvicorn app.main:app --reload --port 8001
```

Open:

- App: http://127.0.0.1:8001
- API docs: http://127.0.0.1:8001/docs

For frontend development, run `npm run dev` inside `frontend/`. Vite runs on
http://127.0.0.1:5173 and proxies `/api` requests to FastAPI on port 8001.

## API

| Method | Path | What it does |
| --- | --- | --- |
| GET | `/api/state` | Customer 360 snapshot |
| POST | `/api/contract/generate` | Draft Experience.com Agreement |
| POST | `/api/contract/send` | Send for signature |
| POST | `/api/signing/advance` | Next signing stage |
| POST | `/api/clock` | `{ "preset": "start" \| "renewal_window" }` |
| POST | `/api/renewal/start` | Open Renewal 2027 on the same ABC Corp record |
| POST | `/api/reset` | Reset demo data |

Signing stages: Draft → Sent to Customer → Customer Signed → Experience.com Countersigned → Fully Executed.

Renewal never creates a second customer. It adds a deal under ABC Corp:

```
ABC Corp
├── Contacts
├── Deals
│    ├── Initial Purchase — Won
│    └── Renewal 2027 — Open
├── Contracts
│    └── 2026–27 — Active
├── Documents
└── Activity
```
