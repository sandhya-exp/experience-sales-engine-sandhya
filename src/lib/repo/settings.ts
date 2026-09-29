import { query, queryOne } from "@/lib/db";

/**
 * app_settings: key → JSON. Used for state that belongs to the application
 * rather than to a lead (connector toggles, custom MCP servers). Tolerant of
 * the table not existing yet — reads return the default, writes report why —
 * so a deploy that lands before `npm run db:schema` still renders.
 */
let available: Promise<boolean> | null = null;
export function settingsAvailable(): Promise<boolean> {
  available ??= queryOne<{ n: number }>(`select count(*)::int as n from information_schema.tables where table_name = 'app_settings'`)
    .then((r) => (r?.n ?? 0) > 0)
    .catch(() => false);
  return available;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  if (!(await settingsAvailable())) return fallback;
  const row = await queryOne<{ value: T }>("select value from app_settings where key = $1", [key]);
  return row ? row.value : fallback;
}

export async function setSetting<T>(key: string, value: T): Promise<{ ok: boolean; detail?: string }> {
  if (!(await settingsAvailable())) return { ok: false, detail: "The app_settings table does not exist yet — run `npm run db:schema`." };
  await query(
    `insert into app_settings (key, value, updated_at) values ($1, $2::jsonb, now())
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
  return { ok: true };
}
