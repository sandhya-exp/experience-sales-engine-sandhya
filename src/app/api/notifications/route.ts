import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getNotificationState } from "@/lib/notifications";

/** Polled by the header bell so a new inquiry shows up without a page reload. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.json(await getNotificationState(), { headers: { "cache-control": "no-store" } });
}
