# Deploying the Sales Engine publicly

Three services, all free tiers:

| Piece | Host | Why |
|---|---|---|
| Postgres | Supabase | Competition stack; `DATABASE_URL` is the only change |
| Lead & Deal Workspace (Next.js) | Vercel | Native Next.js hosting |
| Guided Selling module (FastAPI) | Render | `render.yaml` at the repo root; in-memory store |

## 1. Supabase
1. New project → Settings → Database → **Connection string → URI** (use the *Session pooler* or direct URI, port 5432). Replace `[YOUR-PASSWORD]`.
2. From your Mac, apply schema + seed once:
   ```bash
   DATABASE_URL='postgres://…supabase…:5432/postgres' npm run db:setup
   ```

## 2. Render (Guided Selling module)
1. New → **Blueprint** → connect the GitHub repo → it reads `render.yaml`.
2. Set `HANDOFF_API_KEY` to a long random string. Note the service URL, e.g. `https://sales-engine-guided-selling.onrender.com`.

## 3. Vercel (workspace)
1. New project → import the GitHub repo (framework: Next.js, root `/`).
2. Environment variables:
   - `DATABASE_URL` — Supabase URI from step 1
   - `SESSION_SECRET` — long random string
   - `QUOTE_WORKSPACE_URL` — Render URL from step 2
   - `HANDOFF_API_KEY` — same value as Render
   - `INBOUND_API_KEY` — any random string
   - `ANTHROPIC_API_KEY` — your key (AI stages run on Claude; omit for deterministic)
   - `NEXT_PUBLIC_STAGE_NAME=Guided Selling`, `NEXT_PUBLIC_PARTNER_MODULE_NAME=Guided Selling`
   - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_ALLOWED_DOMAINS=experience.com` (optional)
3. Deploy. Note the URL, e.g. `https://sales-engine-xyz.vercel.app`.
4. Google Cloud → OAuth client → add `https://<vercel-url>` to JavaScript origins and `https://<vercel-url>/api/auth/google/callback` to redirect URIs (only if Google sign-in is used).

## 4. Verify the live URL end to end
- `/inquire` → submit → sign in → new lead in Sales Pipeline and 🔔
- Meridian Home Loans → AI Intelligence (badge shows **Claude · …** when the key is set)
- **Continue to Guided Selling →** → Quote Context → module opens embedded with the same customer

Notes: Render's free tier sleeps after inactivity — the first Guided Selling open may take ~30 s; the workspace page shows "module starting" and re-delivers the handoff automatically. The module's store is in-memory, so it resets on restart; the workspace re-sends the context when it notices.
