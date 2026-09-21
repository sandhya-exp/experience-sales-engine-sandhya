import crypto from "crypto";

/**
 * The session cookie's name and signature, in one place, because two things
 * read it: the app (`lib/auth`, via next/headers) and the proxy in front of the
 * contract module (via the request object). They must agree, and a second copy
 * of the HMAC would be the kind of drift that quietly opens a door.
 */
export const SESSION_COOKIE = "se_session";

export function signSession(value: string) {
  const secret = process.env.SESSION_SECRET || "dev-only-change-me";
  const sig = crypto.createHmac("sha256", secret).update(value).digest("hex");
  return `${value}.${sig}`;
}

/** The user id carried by a valid cookie, or null. Constant-time comparison. */
export function verifySession(signed: string | undefined): string | null {
  if (!signed) return null;
  const [value, sig] = signed.split(".");
  if (!value || !sig) return null;
  const expected = signSession(value).split(".")[1];
  if (sig.length !== expected.length) return null;
  const ok = crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  return ok ? value : null;
}
