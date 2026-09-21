# Deploying the Sales Engine publicly

**One application, one deployment, one URL.** The Next.js workspace and the
quote module (FastAPI) ship in a single container built from the `Dockerfile` at
the repo root. The module listens on the container's loopback; the workspace
proxies it (`next.config.ts`) and is the only public listener. From outside —
and to a judge — there is one service.

Two pieces to set up:

| Piece | Host | Why |
|---|---|---|
| Postgres | Supabase | Competition stack; `DATABASE_URL` is the only change |
| The whole Sales Engine | Render (Docker) | One service, `render.yaml` at the repo root |

Python cannot run inside Node, so there are still two processes inside the
container. `scripts/start.mjs` supervises them: if either stops, the container
stops, so the platform restarts a whole healthy instance rather than serving a
half-working product.

## 1. Supabase

1. New project → Settings → Database → **Connection string → URI** (Session
   pooler or direct URI, port 5432). Replace `[YOUR-PASSWORD]`.
2. From your Mac, apply schema + seed once:
   ```bash
   DATABASE_URL='postgres://…supabase…:5432/postgres' npm run db:setup
   ```

## 2. Render

1. Push to GitHub.
2. New → **Blueprint** → connect the repo → it reads `render.yaml` and builds
   the Dockerfile. One web service, no second service to wire up.
3. Set the environment variables Render marks as required:
   - `DATABASE_URL` — the Supabase URI from step 1.
   - `SESSION_SECRET`, `HANDOFF_API_KEY` — Render generates both; leave them.
   - Optional: `ANTHROPIC_API_KEY` (without it the AI runs deterministically and
     the badge says so), `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` /
     `GOOGLE_ALLOWED_DOMAINS` for Google sign-in, and the calendar variables in
     `GOOGLE-CALENDAR.md`.

   Do **not** set `QUOTE_WORKSPACE_URL`. It is pinned in the Dockerfile to the
   container's loopback: `next.config.ts` bakes the proxy destinations at build
   time and `scripts/start.mjs` derives the module's listen port from the same
   value, so the two cannot drift. Overriding it from the dashboard is how you
   would get a Quote Ready page that 500s with nothing in the logs.

4. If you use Google sign-in, add `https://<your-service>.onrender.com/api/auth/google/callback`
   to the OAuth client's authorised redirect URIs, and the origin alongside it.

## 3. Verify the live URL

Open the Render URL and walk the whole flow on the deployed site, not locally:

1. `/inquire` — submit a Talk to Sales inquiry, book a discovery slot.
2. Sign in, confirm the inquiry is on Home and in the pipeline.
3. Open the opportunity: AI Opportunity Intelligence, qualification.
4. **Quote Ready** — the module must render in the right-hand panel on the same
   customer. This is the one to check: it is the only part that depends on the
   proxy.
5. Submit that URL on the intake form. It is the whole product.

## Notes

- Render's free tier sleeps after inactivity; the first request after a sleep
  takes ~30 s while the container starts. Open the live URL a minute before a
  demo.
- The module's store is in memory, so it resets when the container restarts. The
  workspace notices and re-delivers the quote context for the opportunity you
  open, so the same customer reappears — never a second one.
- Local development is unchanged: `npm run dev` runs the same two processes with
  hot reload. `scripts/start.mjs` is the production entrypoint only.
- To run the container locally exactly as Render will:
  ```bash
  docker build -t sales-engine .
  docker run -p 3000:3000 -e DATABASE_URL='…' -e SESSION_SECRET=dev sales-engine
  ```
