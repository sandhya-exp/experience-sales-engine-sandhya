import { Pool } from "pg";

// Single data-access boundary for the whole app. Everything else (server
// actions, route handlers) goes through `query`/`getPool` — nothing talks to
// Postgres directly elsewhere. That means swapping this file's internals for
// `@supabase/supabase-js` later (e.g. to pick up Supabase Auth or Realtime)
// does not require touching any page or component.
let pool: Pool | undefined;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set. Copy .env.example to .env.local.");
    }
    // Hosted Postgres (Supabase, Neon, RDS…) requires TLS; local Postgres usually has none.
    const local = /localhost|127\.0\.0\.1/.test(connectionString);
    pool = new Pool({ connectionString, ssl: local ? undefined : { rejectUnauthorized: false }, max: 5 });
  }
  return pool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T[]> {
  const { rows } = await getPool().query(text, params);
  return rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params: unknown[] = []
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}
