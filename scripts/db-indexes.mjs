#!/usr/bin/env node
/**
 * Add the read-path indexes from db/schema.sql to an existing database without
 * psql — pure Node, using the app's own `pg` driver. Idempotent: every
 * statement is `create index if not exists`, so re-running is harmless.
 *
 *   DATABASE_URL=... node scripts/db-indexes.mjs      (or npm run db:indexes)
 */
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import pg from "pg";

const root = path.resolve(import.meta.dirname, "..");
function fromEnvFile(file) {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}
const url = process.env.DATABASE_URL || fromEnvFile(path.join(root, ".env.local")) || fromEnvFile(path.join(root, ".env"));
if (!url) {
  console.error("DATABASE_URL is not set.");
  process.exit(1);
}

const schema = readFileSync(path.join(root, "db", "schema.sql"), "utf8");
const statements = schema.match(/create (?:unique )?index if not exists[^;]+;/gi) ?? [];

const local = /localhost|127\.0\.0\.1/.test(url);
const client = new pg.Client({ connectionString: url, ssl: local ? undefined : { rejectUnauthorized: false } });
await client.connect();
console.log(`Ensuring ${statements.length} indexes on ${url.replace(/\/\/([^@]*)@/, "//****@")}`);
for (const sql of statements) {
  const name = sql.match(/if not exists (\S+)/i)?.[1];
  const started = Date.now();
  await client.query(sql);
  console.log(`  ✓ ${name} (${Date.now() - started}ms)`);
}
const { rows } = await client.query(`select relname, n_live_tup from pg_stat_user_tables where relname in ('activities','leads','contacts','companies') order by relname`);
for (const r of rows) console.log(`  ${r.relname}: ~${r.n_live_tup} rows`);
await client.query("analyze");
console.log("  ✓ analyze");
await client.end();
