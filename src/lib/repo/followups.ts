import { query, queryOne } from "@/lib/db";
import { recordActivity } from "@/lib/repo/activities";
import type { Activity } from "@/lib/types";

/**
 * Scheduled follow-ups ("Discovery call · Sat, Sep 26 · 11:00 AM") ride on the
 * activity timeline: a `call` activity with `metadata.scheduled_for`. No new
 * table — the timeline already is the record of what's happening on a lead,
 * and a booked call is exactly that. `metadata.kind` = "follow_up".
 */
export interface FollowUp {
  activityId: string;
  scheduledFor: string;
  title: string;
  source: "customer" | "rep";
  completed: boolean;
}

export const FOLLOW_UP_KIND = "follow_up";

export async function scheduleFollowUp(input: {
  leadId: string;
  scheduledFor: Date;
  title?: string;
  note?: string | null;
  actorName: string;
  source: "customer" | "rep";
}): Promise<Activity> {
  const title = input.title?.trim() || "Discovery call";
  return recordActivity({
    leadId: input.leadId,
    type: "call",
    body: `${title} booked for ${formatWhen(input.scheduledFor)}${input.note ? ` — ${input.note}` : ""}`,
    actorName: input.actorName,
    metadata: {
      kind: FOLLOW_UP_KIND,
      title,
      scheduled_for: input.scheduledFor.toISOString(),
      source: input.source,
    },
  });
}

/** Mark a follow-up as done (a call/note logged afterwards also counts — see needsAttention). */
export async function completeFollowUp(activityId: string) {
  await query(
    `update activities set metadata = metadata || '{"completed": true}'::jsonb where id = $1`,
    [activityId]
  );
}

export async function nextFollowUpFor(leadId: string): Promise<FollowUp | null> {
  const row = await queryOne<{ id: string; metadata: Record<string, unknown> }>(
    `select id, metadata from activities
     where lead_id = $1 and metadata->>'kind' = $2 and coalesce((metadata->>'completed')::boolean, false) = false
     order by (metadata->>'scheduled_for')::timestamptz desc limit 1`,
    [leadId, FOLLOW_UP_KIND]
  );
  if (!row) return null;
  return {
    activityId: row.id,
    scheduledFor: String(row.metadata.scheduled_for),
    title: String(row.metadata.title ?? "Follow-up"),
    source: (row.metadata.source as "customer" | "rep") ?? "rep",
    completed: Boolean(row.metadata.completed),
  };
}

function formatWhen(d: Date) {
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
