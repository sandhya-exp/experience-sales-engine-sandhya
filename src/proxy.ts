import { NextResponse, type NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/session-cookie";
import { canAccessContract, toRole, type Role } from "@/lib/roles";

/**
 * The server-side half of role-based access, in front of everything.
 *
 * Page and API guards live in the pages and handlers themselves, but the
 * contract module is not a Next route: `next.config.ts` rewrites
 * /quote-module, /assets, /static and the unmatched /api/* straight to the
 * module process. Those rewrites bypass app routing entirely, so a guard in a
 * page cannot cover them. The proxy runs before every rewrite stage (headers →
 * redirects → proxy → beforeFiles → filesystem → afterFiles → dynamic →
 * fallback), which makes it the only place that can.
 *
 * A Sales User therefore cannot reach the module by typing its URL, loading its
 * bundle, or calling its API directly — the request never leaves this process.
 *
 * Runtime is Node (the default for proxy in Next 16), so the role comes from
 * the database rather than from anything the browser could edit. The lookup is
 * cached for a few seconds because the module's asset requests arrive in
 * bursts; a role change is live within that window.
 */

/** Everything behind the contract boundary, whether ours or the module's. */
const CONTRACT_PREFIXES = ["/quote-module", "/assets/", "/static/", "/api/handoff", "/api/quote-module"];

/** This app's own API surface. Anything else under /api is proxied to the module. */
const APP_API_PREFIXES = ["/api/activity", "/api/auth", "/api/availability", "/api/inquiries", "/api/notifications"];

/** Contract-boundary pages that are ours (guarded again in the page itself). */
const isContractPage = (p: string) => p === "/guided-selling" || /^\/leads\/[^/]+\/quote$/.test(p);

function isProtected(pathname: string): boolean {
  if (isContractPage(pathname)) return true;
  if (CONTRACT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p))) return true;
  // Unmatched /api/* falls through to the module, so treat anything that is not
  // one of ours as the module's — an allowlist, so a new module endpoint is
  // closed by default rather than open until someone remembers to add it.
  if (pathname.startsWith("/api/")) return !APP_API_PREFIXES.some((p) => pathname.startsWith(p));
  return false;
}

const TTL_MS = 5_000;
const cache = new Map<string, { role: Role; at: number }>();

async function roleOf(userId: string): Promise<Role | null> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.role;
  try {
    const row = await queryOne<{ role: string | null }>("select role from app_users where id = $1", [userId]);
    if (!row) return null;
    const role = toRole(row.role);
    cache.set(userId, { role, at: Date.now() });
    return role;
  } catch {
    // If the role cannot be established, the request is not authorised.
    return null;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (!isProtected(pathname)) return NextResponse.next();

  // Server-to-server: the module pulls lead context with the shared key and has
  // no browser session. Unchanged by roles.
  const key = process.env.HANDOFF_API_KEY;
  if (key && request.headers.get("x-sales-engine-key") === key) return NextResponse.next();

  const userId = verifySession(request.cookies.get(SESSION_COOKIE)?.value);
  const role = userId ? await roleOf(userId) : null;
  if (canAccessContract(role)) return NextResponse.next();

  const isPage = isContractPage(pathname) || pathname === "/quote-module" || pathname.startsWith("/quote-module/");
  if (!userId && isPage) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", pathname);
    return NextResponse.redirect(login);
  }
  // Signed in without the role: back to the workspace for a page, a plain
  // refusal for anything a script or an iframe asked for.
  if (isPage) return NextResponse.redirect(new URL("/", request.url));
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

export const config = {
  matcher: [
    "/guided-selling",
    "/leads/:id/quote",
    "/quote-module",
    "/quote-module/:path*",
    "/assets/:path*",
    "/static/:path*",
    "/api/:path*",
  ],
};
