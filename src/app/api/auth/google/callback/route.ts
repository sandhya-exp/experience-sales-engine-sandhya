import { NextResponse, type NextRequest } from "next/server";
import { exchangeGoogleCode, userForGoogleProfile } from "@/lib/google-auth";
import { createSession } from "@/lib/auth";

/** Step 2: Google sends the user back with a code; exchange it, match the account, start a session. */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const expected = req.cookies.get("se_oauth_state")?.value;
  const fail = (reason: string) => {
    const res = NextResponse.redirect(`${origin}/login?error=${reason}`);
    res.cookies.delete("se_oauth_state");
    return res;
  };
  if (!code || !state || state !== expected) return fail("google_state");
  try {
    const profile = await exchangeGoogleCode(origin, code);
    const user = await userForGoogleProfile(profile);
    if (!user) return fail("google_domain");
    await createSession(user.id);
    const res = NextResponse.redirect(`${origin}/`);
    res.cookies.delete("se_oauth_state");
    return res;
  } catch (err) {
    console.error("Google sign-in failed:", err);
    return fail("google_failed");
  }
}
