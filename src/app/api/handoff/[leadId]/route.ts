import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { canAccessContract } from "@/lib/roles";
import { buildHandoffPayload } from "@/lib/handoff";

/**
 * GET /api/handoff/{leadId}
 *
 * The "pull" side of the Quote Ready handoff: the downstream module fetches the
 * complete lead/account context for a lead it was pointed at. Same payload the
 * "push" POST sends. Authorised by either a signed-in Sales Engine session
 * (same browser) or the shared HANDOFF_API_KEY header (server-to-server).
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/handoff/[leadId]">) {
  const { leadId } = await ctx.params;
  const h = await headers();

  const key = process.env.HANDOFF_API_KEY;
  const keyOk = Boolean(key) && h.get("x-sales-engine-key") === key;
  const user = keyOk ? null : await getCurrentUser();
  if (!keyOk && !user) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401, headers: cors() });
  }
  if (!keyOk && !canAccessContract(user?.role)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, headers: cors() });
  }

  const origin = originFrom(h);
  const payload = await buildHandoffPayload(leadId, user?.name ?? "quote-workspace", origin);
  if (!payload) return NextResponse.json({ error: "lead not found" }, { status: 404, headers: cors() });

  return NextResponse.json(payload, { headers: { ...cors(), "cache-control": "no-store" } });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

function cors() {
  return {
    "access-control-allow-origin": process.env.QUOTE_WORKSPACE_URL ?? "*",
    "access-control-allow-headers": "content-type, x-sales-engine-key",
    "access-control-allow-methods": "GET, OPTIONS",
  };
}

function originFrom(h: Awaited<ReturnType<typeof headers>>) {
  const proto = h.get("x-forwarded-proto") ?? "http";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}
