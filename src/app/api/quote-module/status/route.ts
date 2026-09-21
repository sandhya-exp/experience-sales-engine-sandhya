import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { canAccessContract } from "@/lib/roles";
import { quoteModuleStatus } from "@/lib/quote-module";

export const dynamic = "force-dynamic";

/**
 * Is the quote module answering *this server*? The Quote Ready panel calls this
 * when its iframe fails to load, to tell two very different faults apart:
 *
 *   server says unreachable → the module isn't started.
 *   server says ok          → the module is up but the browser can't reach the
 *                             embed URL (e.g. a deployed workspace still
 *                             pointing QUOTE_WORKSPACE_URL at 127.0.0.1).
 *
 * Internal only — it reveals the module's configured URL.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!canAccessContract(user.role)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return NextResponse.json(await quoteModuleStatus());
}
