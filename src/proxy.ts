import { NextResponse, type NextRequest } from "next/server";
import { queryOne } from "@/lib/db";
import { SESSION_COOKIE, verifySession } from "@/lib/session-cookie";
import { canAccessContract, toRole, type Role } from "@/lib/roles";

/**
 * The server-side half of role-based access, in front of everything.
 *
 * Page and API guards live in the pages and handlers themselves; this runs
 * before all of them (headers → redirects → proxy → rewrites → filesystem →
 * dynamic routes), so a Sales User is refused at the edge rather than deep
 * inside a handler, and a new route under a protected prefix is covered the
 * moment it exists.
 *
 * Runtime is Node (the default for proxy in Next 16), so the role comes from
 * the database rather than from anything the browser could edit. The lookup is
 * cached for a few seconds because the module's asset requests arrive in
 * bursts; a role change is live within that window.
 */

/** Everything behind the contract boundary. */
const CONTRACT_PREFIXES = ["/api/handoff"];

/** Contract-boundary pages (guarded again in the page itself). */
const isContractPage = (p: string) => /^\/leads\/[^/]+\/quote$/.test(p);

function isProtected(pathname: string): boolean {
  if (isContractPage(pathname)) return true;
  return CONTRACT_PREFIXES.some((p) => pathname === p || pathname.startsWith(p));
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

  const isPage = isContractPage(pathname);
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
  matcher: ["/leads/:id/quote", "/api/handoff/:path*"],
};
