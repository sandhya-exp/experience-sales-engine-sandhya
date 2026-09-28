import { NextResponse } from "next/server";
import { runTool, SALES_TOOLS, SalesToolTrace } from "@/lib/ai/salesTools";

export const dynamic = "force-dynamic";

/**
 * MCP server — the Sales Engine tool registry over the Model Context Protocol
 * (Streamable HTTP transport, JSON responses).
 *
 * Any MCP client (Claude Desktop, Claude Code, an agent SDK) can connect with:
 *   URL:    https://<your-app>/api/mcp
 *   Header: Authorization: Bearer <MCP_API_KEY>
 *
 * It exposes exactly the tools the in-app agent uses, with the same rules:
 * prices only from the catalog, deal history labelled as history, and
 * customer-facing steps (sending a message, marking Won) only ever raised as
 * approval requests a person resolves in the workspace. No secret, key or
 * connection string is ever part of a tool result.
 */
const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "experience-sales-engine", title: "Experience.com Sales Engine", version: "1.0.0" };

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

export async function POST(request: Request) {
  const key = process.env.MCP_API_KEY?.trim();
  const auth = request.headers.get("authorization") ?? "";
  if (!key || auth !== `Bearer ${key}`) {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32001, message: "Unauthorized" } }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, { status: 400 });
  }

  const batch = Array.isArray(body) ? (body as JsonRpcRequest[]) : [body as JsonRpcRequest];
  const responses = (await Promise.all(batch.map(handle))).filter((r): r is NonNullable<typeof r> => r !== null);
  if (!responses.length) return new Response(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? responses : responses[0], { headers: { "mcp-protocol-version": PROTOCOL_VERSION } });
}

export async function GET() {
  // No server-initiated stream; clients use POST.
  return new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });
}

async function handle(req: JsonRpcRequest) {
  if (!req || req.jsonrpc !== "2.0" || typeof req.method !== "string") return rpcError(null, -32600, "Invalid Request");
  const isNotification = req.id === undefined || req.id === null;
  const id = req.id ?? null;

  switch (req.method) {
    case "initialize":
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Experience.com Sales Engine. Prices come only from get_products / get_product_price / calculate_quote_total — never state a price you did not get from them. Deal history (ACV/ARR) is customer history, not pricing. send_customer_message and mark_opportunity_won only create approval requests; a person completes them. Price list is a labelled demo list.",
      });
    case "notifications/initialized":
    case "notifications/cancelled":
      return null;
    case "ping":
      return ok(id, {});
    case "tools/list":
      return ok(id, {
        tools: SALES_TOOLS.map((t) => ({
          name: t.name,
          title: t.name.replace(/_/g, " "),
          description: `[${t.kind}] ${t.description}`,
          inputSchema: t.input_schema,
          annotations: { readOnlyHint: t.kind === "read" || t.kind === "compute", destructiveHint: false, openWorldHint: false },
        })),
      });
    case "tools/call": {
      const name = String(req.params?.name ?? "");
      const args = (req.params?.arguments ?? {}) as Record<string, unknown>;
      const trace = new SalesToolTrace();
      const r = await runTool(name, args, { actorName: "MCP client", trace });
      const call = trace.calls[0];
      console.info(`[mcp] ${name} ${call?.ok ? "ok" : "error"} ${call?.duration_ms ?? 0}ms → ${call?.output ?? ""}`);
      if (!r.ok) return ok(id, { content: [{ type: "text", text: r.error ?? "Tool failed" }], isError: true });
      return ok(id, {
        content: [{ type: "text", text: JSON.stringify({ summary: r.summary, sources: r.sources ?? [], data: r.data }, null, 2) }],
        structuredContent: { summary: r.summary, sources: r.sources ?? [], data: r.data },
      });
    }
    default:
      return isNotification ? null : rpcError(id, -32601, `Method not found: ${req.method}`);
  }
}

function ok(id: string | number | null, result: unknown) {
  return { jsonrpc: "2.0" as const, id, result };
}
function rpcError(id: string | number | null, code: number, message: string) {
  return { jsonrpc: "2.0" as const, id, error: { code, message } };
}
