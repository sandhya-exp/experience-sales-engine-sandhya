import { cookies } from "next/headers";
import bcrypt from "bcryptjs";
import { SESSION_COOKIE, signSession, verifySession } from "@/lib/session-cookie";
import { queryOne } from "@/lib/db";
import { toRole, type Role } from "@/lib/roles";

// P0 auth: a single session cookie signed with SESSION_SECRET, checked
// against app_users. Deliberately minimal — full org/permission management is
// the Admin discipline's scope (see architecture doc, out of scope section).
// What lives here is the one distinction this product needs: the account's
// role, which decides whether the contract boundary is open to them.
//
// The role is read from the database on every request rather than carried in
// the cookie, so changing someone's role takes effect immediately and a stolen
// or edited cookie can never grant more than the account actually has.

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

type UserRow = { id: string; name: string; email: string; role: string | null };

const toSessionUser = (row: UserRow): SessionUser => ({
  id: row.id,
  name: row.name,
  email: row.email,
  role: toRole(row.role),
});

export async function verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
  const user = await queryOne<UserRow & { password_hash: string }>(
    "select id, name, email, role, password_hash from app_users where email = $1",
    [email.toLowerCase().trim()]
  );
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;
  return toSessionUser(user);
}

/** `remember` = keep the session for 7 days; otherwise it ends with the browser session. */
export async function createSession(userId: string, remember = true) {
  const store = await cookies();
  store.set(SESSION_COOKIE, signSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { maxAge: 60 * 60 * 24 * 7 } : {}),
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const userId = verifySession(store.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  const user = await queryOne<UserRow>(
    "select id, name, email, role from app_users where id = $1",
    [userId]
  );
  return user ? toSessionUser(user) : null;
}

/** The signed-in user's id, without a database round trip. Used by the proxy. */
export async function sessionUserId(): Promise<string | null> {
  const store = await cookies();
  return verifySession(store.get(SESSION_COOKIE)?.value);
}

/** Role for a user id — the proxy's check, kept on the same code path as the app's. */
export async function roleForUserId(userId: string): Promise<Role | null> {
  const row = await queryOne<{ role: string | null }>("select role from app_users where id = $1", [userId]);
  return row ? toRole(row.role) : null;
}
