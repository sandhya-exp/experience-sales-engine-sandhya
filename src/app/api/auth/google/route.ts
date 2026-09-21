import { NextResponse, type NextRequest } from "next/server";
import crypto from "crypto";
import { googleAuthConfig, googleAuthorizeUrl } from "@/lib/google-auth";

/** Step 1: send the user to Google. Without credentials configured, explain on the login page instead. */
export async function GET(req: NextRequest) {
  const origin = req.nextUrl.origin;
  if (!googleAuthConfig().enabled) {
    return NextResponse.redirect(`${origin}/login?error=google_not_configured`);
  }
  const state = crypto.randomBytes(16).toString("hex");
  const res = NextResponse.redirect(googleAuthorizeUrl(origin, state));
  res.cookies.set("se_oauth_state", state, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  return res;
}
