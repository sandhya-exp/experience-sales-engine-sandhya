# Deploying the Sales Engine publicly

**One application, one deployment, one URL.** The Sales Engine is a single
Next.js application, shipped in one container built from the `Dockerfile` at the
repo root.

Two pieces to set up:

| Piece | Host | Why |
|---|---|---|
| Postgres | Supabase | Competition stack; `DATABASE_URL` is the only change |
| The Sales Engine | Render (Docker) | One service, `render.yaml` at the repo root |

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
     the badge says so), and the calendar variables in
     `GOOGLE-CALENDAR.md`.

4. If you use Google sign-in, add `https://<your-service>.onrender.com/api/auth/google/callback`
   to the OAuth client's authorised redirect URIs, and the origin alongside it.

## 3. Verify the live URL

Open the Render URL and walk the whole flow on the deployed site, not locally:

1. `/inquire` — submit a Talk to Sales inquiry, book a discovery slot.
2. Sign in, confirm the inquiry is on Home and in the pipeline.
3. Open the opportunity: AI Opportunity Intelligence, qualification.
4. **Continue to Contract** on a qualified opportunity: the quote context
   screen, then the handoff recorded on the timeline.
5. Submit that URL on the intake form. It is the whole product.

## Notes

- Render's free tier sleeps after inactivity; the first request after a sleep
  takes ~30 s while the container starts. Open the live URL a minute before a
  demo.
- Local development is the same application: `npm run dev` with hot reload.
- To run the container locally exactly as Render will:
  ```bash
  docker build -t sales-engine .
  docker run -p 3000:3000 -e DATABASE_URL='…' -e SESSION_SECRET=dev sales-engine
  ```
