/**
 * Reachability of the quote module (modules/guided-selling — Sadhana's FastAPI
 * app) from *this server*.
 *
 * The module is a separate process: FastAPI on its own port, serving its built
 * React app at `/` and its API under `/api`. The workspace embeds it; it does
 * not host it. So "is it up" is a real question with three distinct answers,
 * and the Quote Ready page needs to tell them apart rather than showing one
 * quiet line of grey text for all of them:
 *
 *   not_configured  QUOTE_WORKSPACE_URL is unset — nothing to embed.
 *   unreachable     configured, but /api/health did not answer — not started.
 *   ok              answering; the iframe should render it.
 *
 * The probe retries once with a real timeout. A cold uvicorn importing FastAPI,
 * pydantic and fpdf takes a while on the first request — around 0.6s on a fast
 * Linux box and several times that on a laptop — and the previous single 1.5s
 * attempt reported a module that was merely still starting as "not running".
 */
export type QuoteModuleState = "ok" | "unreachable" | "not_configured";

export interface QuoteModuleStatus {
  state: QuoteModuleState;
  baseUrl: string | null;
  /** The URL that was probed, so the UI can show exactly what was tried. */
  healthUrl: string | null;
  /** Transport-level reason when unreachable (ECONNREFUSED, timeout, …). */
  detail: string | null;
  /** The command that starts the module, for the UI to show verbatim. */
  startCommand: string;
  checkedAt: string;
}

/**
 * Where the module is mounted on *this* origin. The workspace proxies it (see
 * next.config.ts), so the browser only ever talks to one server, and the embed
 * URL is a relative path that works identically on localhost and on a deployed
 * domain. Server-to-server calls (the handoff push, the health probe) still go
 * straight to QUOTE_WORKSPACE_URL — there is no reason to loop those through
 * the proxy, and probing directly is what tells "module down" apart from
 * "proxy misconfigured".
 */
export const MODULE_MOUNT = "/quote-module";

/**
 * The same-origin URL that embeds the module, for one opportunity or bare.
 *
 * `embed=1` is always on: it tells the module the host already provides the
 * shell, so it drops its own brand block, account picker and left rail and lays
 * its steps out horizontally. Embedding without it was what put a second full
 * application chrome inside the panel.
 */
export function moduleEmbedPath(accountKey?: string, leadId?: string): string {
  const p = new URLSearchParams();
  if (leadId) p.set("lead_id", leadId);
  if (accountKey) p.set("customer_id", accountKey);
  p.set("embed", "1");
  return `${MODULE_MOUNT}?${p.toString()}`;
}

export const START_COMMAND = "npm run dev";
export const START_COMMAND_MODULE_ONLY =
  "cd modules/guided-selling && .venv/bin/uvicorn app.main:app --port 8001";

const ATTEMPT_TIMEOUT_MS = 4000;

/**
 * Read the module's URL straight from the environment rather than through
 * lib/handoff, which reaches the database. This file is imported by a client
 * component for MODULE_MOUNT, so it must stay free of server-only dependencies
 * or `pg` ends up in the browser bundle.
 */
function moduleBaseUrl(): string | null {
  const v = process.env.QUOTE_WORKSPACE_URL?.trim().replace(/\/$/, "");
  return v ? v : null;
}

async function probe(url: string): Promise<{ ok: boolean; detail: string | null }> {
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS) });
    return res.ok ? { ok: true, detail: null } : { ok: false, detail: `responded ${res.status}` };
  } catch (err) {
    const e = err as { name?: string; cause?: { code?: string }; message?: string };
    if (e?.name === "TimeoutError") return { ok: false, detail: `no response within ${ATTEMPT_TIMEOUT_MS}ms` };
    return { ok: false, detail: e?.cause?.code ?? e?.message ?? "connection failed" };
  }
}

export async function quoteModuleStatus(): Promise<QuoteModuleStatus> {
  const baseUrl = moduleBaseUrl();
  const base = {
    baseUrl,
    startCommand: START_COMMAND,
    checkedAt: new Date().toISOString(),
  };
  if (!baseUrl) return { ...base, state: "not_configured", healthUrl: null, detail: null };

  const healthUrl = `${baseUrl}/api/health`;
  let last = await probe(healthUrl);
  // One retry: the first request after `npm run dev` often lands while uvicorn
  // is still importing, and a started-but-cold module is not a stopped one.
  if (!last.ok) last = await probe(healthUrl);

  return { ...base, healthUrl, state: last.ok ? "ok" : "unreachable", detail: last.detail };
}
