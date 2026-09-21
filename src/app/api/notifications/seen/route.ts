import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { markInquiriesSeen, getNotificationState } from "@/lib/notifications";

export async function POST() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  await markInquiriesSeen();
  return NextResponse.json(await getNotificationState());
}
