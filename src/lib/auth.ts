import { cookies } from "next/headers";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { queryOne } from "@/lib/db";

// P0 auth: a single session cookie signed with SESSION_SECRET, checked
// against app_users. This is intentionally minimal — org/role/permission
// management is the Admin discipline's scope (see architecture doc, out of
// scope section), not this one.

const COOKIE_NAME = "se_session";

function sign(value: string) {
  const secret = process.env.SESSION_SECRET || "dev-only-change-me";
  const sig = crypto.createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${sig}`;
}

function verify(signed: string | undefined): string | null {
  if (!signed) return null;
  const [value, sig] = signed.split(".");
  if (!value || !sig) return null;
  const expected = sign(value).split(".")[1];
  if (sig.length !== expected.length) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return ok ? value : null;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
}

export async function verifyCredentials(email: string, password: string): Promise<SessionUser | null> {
  const user = await queryOne<{ id: string; name: string; email: string; password_hash: string }>(
    "select id, name, email, password_hash from app_users where email = $1",
    [email.toLowerCase().trim()]
  );
  if (!user) return null;
  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) return null;
  return { id: user.id, name: user.name, email: user.email };
}

/** `remember` = keep the session for 7 days; otherwise it ends with the browser session. */
export async function createSession(userId: string, remember = true) {
  const store = await cookies();
  store.set(COOKIE_NAME, sign(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    ...(remember ? { maxAge: 60 * 60 * 24 * 7 } : {}),
  });
}

export async function destroySession() {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const store = await cookies();
  const userId = verify(store.get(COOKIE_NAME)?.value);
  if (!userId) return null;
  const user = await queryOne<SessionUser>(
    "select id, name, email from app_users where id = $1",
    [userId]
  );
  return user;
}
