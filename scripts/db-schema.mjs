#!/usr/bin/env node
/**
 * Apply db/schema.sql to the database this project is actually configured for.
 *
 * The old form of this script was a bare `psql "${DATABASE_URL:-postgres://postgres@…}"`,
 * which only worked if DATABASE_URL happened to be exported in the shell. It
 * usually isn't — it lives in .env.local, the same file `db:seed` reads — so the
 * fallback kicked in and psql went looking for a `postgres` role that doesn't
 * exist on a Homebrew install. Reading .env.local here makes the two commands
 * agree on which database they mean.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const schema = path.join(root, "db", "schema.sql");

function fromEnvFile(file) {
  if (!existsSync(file)) return null;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*)$/);
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

const url =
  process.env.DATABASE_URL ||
  fromEnvFile(path.join(root, ".env.local")) ||
  fromEnvFile(path.join(root, ".env"));

if (!url) {
  console.error("DATABASE_URL is not set and .env.local has none. Copy .env.example to .env.local first.");
  process.exit(1);
}

// Show which database, never the credentials.
console.log(`Applying db/schema.sql to ${url.replace(/\/\/([^@]*)@/, "//****@")}`);
const res = spawnSync("psql", ["-v", "ON_ERROR_STOP=1", url, "-f", schema], { stdio: "inherit" });
if (res.error?.code === "ENOENT") {
  console.error("psql was not found on PATH. Install the Postgres client tools, or apply db/schema.sql with your own client.");
  process.exit(1);
}
process.exit(res.status ?? 1);
