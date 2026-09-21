import { redirect } from "next/navigation";
import { getCurrentUser, type SessionUser } from "@/lib/auth";
import { canAccessContract } from "@/lib/roles";

/**
 * Server-side authorisation for the one gate in this product: the contract
 * boundary (Ready to Contract, the quote context review, the handoff, and the
 * contract module behind the proxy).
 *
 * Every entry point calls one of these — pages `requireContractAccess`, server
 * actions and route handlers `assertContractAccess` — so hiding a control in
 * the UI is a convenience, never the protection. A Sales User who types the
 * URL, replays a server action or curls the API gets the same answer.
 */

/** Signed-in user, or a redirect to the login page. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** True if the signed-in user may cross the contract boundary. */
export async function hasContractAccess(): Promise<boolean> {
  const user = await getCurrentUser();
  return canAccessContract(user?.role);
}

/**
 * Page guard. A Sales User is sent back to the workspace rather than shown a
 * dead end — the page is simply not part of their product.
 */
export async function requireContractAccess(fallback = "/"): Promise<SessionUser> {
  const user = await requireUser();
  if (!canAccessContract(user.role)) redirect(fallback);
  return user;
}

/**
 * Server action / route handler guard. Returns the user when allowed and null
 * when not, so the caller decides between a thrown error and a 403 body.
 */
export async function assertContractAccess(): Promise<SessionUser | null> {
  const user = await getCurrentUser();
  return user && canAccessContract(user.role) ? user : null;
}
