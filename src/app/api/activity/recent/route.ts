import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { listRecentActivities } from "@/lib/repo/activities";

export const dynamic = "force-dynamic";

/**
 * The newest activity across the pipeline, for the Recent Activity menu in the
 * header. A read of the same `activities` rows the timeline and the /activity
 * view use — nothing is logged, changed or marked seen here. Signed-in only.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  try {
    const items = await listRecentActivities(12);
    return NextResponse.json({
      items: items.map((a) => ({
        id: a.id,
        lead_id: a.lead_id,
        company_name: a.company_name,
        type: a.type,
        body: a.body,
        actor_name: a.actor_name,
        occurred_at: a.occurred_at,
      })),
    });
  } catch (err) {
    console.error("Recent activity failed:", err);
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }
}
