import type { ConnectorToolInfo } from "@/lib/connectors/types";

/**
 * A minimal MCP client over HTTP (JSON-RPC, protocol 2025-06-18) — enough to
 * reach a server, learn its name and list its tools. This is what "Test
 * connection" on a custom server runs, and it is the same wire format the
 * app's own /api/mcp speaks, so the Sales Engine can be added as a server
 * and prove the round trip.
 */
export interface McpProbe {
  ok: boolean;
  serverName: string | null;
  protocolVersion: string | null;
  tools: ConnectorToolInfo[];
  error: string | null;
  latencyMs: number;
}

async function rpc(url: string, token: string | null | undefined, method: string, params: unknown, id: number, signal: AbortSignal) {
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}${text ? `: ${text.slice(0, 160)}` : ""}`);
  // Streamable HTTP servers may answer as SSE; take the first data: line.
  const body = text.trim().startsWith("event:") || text.trim().startsWith("data:") ? (text.split("\n").find((l) => l.startsWith("data:"))?.slice(5).trim() ?? "") : text;
  const json = JSON.parse(body) as { result?: unknown; error?: { message?: string } };
  if (json.error) throw new Error(json.error.message ?? "JSON-RPC error");
  return json.result as Record<string, unknown>;
}

function kindFor(name: string, description: string): ConnectorToolInfo["kind"] {
  const n = `${name} ${description}`.toLowerCase();
  if (/\b(send|create|update|delete|write|book|mark)\b/.test(n) && !/draft/.test(n)) return "request";
  if (/draft|compose/.test(n)) return "draft";
  if (/calculate|validate|compute|check/.test(n)) return "compute";
  return "read";
}

export async function probeMcpServer(url: string, token?: string | null, timeoutMs = 8_000): Promise<McpProbe> {
  const started = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const init = await rpc(url, token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "experience-sales-engine", version: "1.0" } }, 1, ctrl.signal);
    const serverInfo = (init?.serverInfo as { name?: string } | undefined) ?? null;
    const listed = await rpc(url, token, "tools/list", {}, 2, ctrl.signal);
    const raw = (listed?.tools as { name: string; description?: string; inputSchema?: { properties?: Record<string, unknown> } }[] | undefined) ?? [];
    const tools: ConnectorToolInfo[] = raw.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      kind: kindFor(t.name, t.description ?? ""),
      inputs: Object.keys(t.inputSchema?.properties ?? {}),
    }));
    return { ok: true, serverName: serverInfo?.name ?? null, protocolVersion: (init?.protocolVersion as string) ?? null, tools, error: null, latencyMs: Date.now() - started };
  } catch (err) {
    const msg = err instanceof Error ? (err.name === "AbortError" ? `No answer within ${timeoutMs / 1000}s` : err.message) : "Could not reach the server";
    return { ok: false, serverName: null, protocolVersion: null, tools: [], error: msg, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(timer);
  }
}
