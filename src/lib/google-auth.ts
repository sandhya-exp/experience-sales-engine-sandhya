import crypto from "crypto";
import bcrypt from "bcryptjs";
import { queryOne } from "@/lib/db";
import { getUserByEmail } from "@/lib/repo/users";

/**
 * Sign in with Google for the internal team — standard OAuth 2.0 authorization
 * code flow against Google's OpenID endpoints, no SDK. Configure:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET   (Google Cloud → Credentials → OAuth client, Web)
 *   Authorized redirect URI: {APP_URL}/api/auth/google/callback
 *   GOOGLE_ALLOWED_DOMAINS  comma-separated; default "experience.com" — who may get in.
 * An existing app_user signs straight in; a new colleague from an allowed
 * domain gets an account on first sign-in (password-less; a random hash is
 * stored because app_users.password_hash is not null).
 */
export function googleAuthConfig() {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  const allowed = (process.env.GOOGLE_ALLOWED_DOMAINS ?? "experience.com")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
  return { enabled: Boolean(clientId && clientSecret), clientId, clientSecret, allowed };
}

export function googleAuthorizeUrl(origin: string, state: string) {
  const { clientId, allowed } = googleAuthConfig();
  const p = new URLSearchParams({
    client_id: clientId ?? "",
    redirect_uri: `${origin}/api/auth/google/callback`,
    response_type: "code",
    scope: "openid email profile",
    state,
    prompt: "select_account",
  });
  if (allowed.length === 1) p.set("hd", allowed[0]);
  return `https://accounts.google.com/o/oauth2/v2/auth?${p.toString()}`;
}

export async function exchangeGoogleCode(origin: string, code: string) {
  const { clientId, clientSecret } = googleAuthConfig();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId ?? "",
      client_secret: clientSecret ?? "",
      redirect_uri: `${origin}/api/auth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed: ${res.status}`);
  const tokens = (await res.json()) as { id_token?: string };
  if (!tokens.id_token) throw new Error("Google did not return an id_token");
  // The id_token came straight from Google over TLS in this same exchange, so
  // its payload is trustworthy here without a second signature check.
  const payload = JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString("utf8")) as {
    email?: string;
    email_verified?: boolean;
    name?: string;
    hd?: string;
  };
  if (!payload.email || payload.email_verified === false) throw new Error("Google account has no verified email");
  return { email: payload.email.toLowerCase(), name: payload.name ?? payload.email.split("@")[0] };
}

/** Existing colleague → their account. New colleague from an allowed domain → created. Anyone else → null. */
export async function userForGoogleProfile(profile: { email: string; name: string }) {
  const existing = await getUserByEmail(profile.email);
  if (existing) return existing;
  const domain = profile.email.split("@")[1];
  if (!googleAuthConfig().allowed.includes(domain)) return null;
  const randomHash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 10);
  return queryOne<{ id: string; name: string; email: string }>(
    "insert into app_users (name, email, password_hash) values ($1, $2, $3) returning id, name, email",
    [profile.name, profile.email, randomHash]
  );
}
