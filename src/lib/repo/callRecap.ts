import { query, queryOne } from "@/lib/db";
import { recordActivity, type RecordActivityInput } from "@/lib/repo/activities";
import { patchActivityMetadata } from "@/lib/repo/agentActions";
import type { Activity } from "@/lib/types";

/**
 * A processed call transcript lives on the activity timeline, the same way a
 * customer reply does (`repo/agentActions.ts`'s `customer_reply`): a `call`
 * activity carrying its structure in `metadata`. No new table — recording it
 * this way is also what makes it show up automatically as evidence the next
 * time the AI brief refreshes, since the brief already reads the opportunity's
 * recent activities.
 */
export const CALL_RECAP_KIND = "call_recap";

export interface CallRecapFact {
  field: string | null;
  label: string;
  value: string;
  quote: string;
}

export interface CallRecapMeta {
  kind: typeof CALL_RECAP_KIND;
  transcript: string;
  facts: CallRecapFact[];
  systems: { name: string; quote: string }[];
  summary: string;
  next_action: string | null;
  generated_by: "claude" | "deterministic";
  model: string | null;
  note: string | null;
  /** Indices into `facts`/`systems` (systems appended after facts) the salesperson has confirmed. */
  confirmed_indices: number[];
  /** What was actually written to the opportunity once confirmed. */
  applied: string[];
  confirmed_at: string | null;
  confirmed_by: string | null;
}

export interface CallRecapRow {
  activityId: string;
  leadId: string;
  occurredAt: string;
  meta: CallRecapMeta;
}

function toMeta(raw: unknown): CallRecapMeta | null {
  const m = raw as CallRecapMeta | undefined;
  return m && m.kind === CALL_RECAP_KIND ? m : null;
}

export async function recordCallRecap(leadId: string, meta: CallRecapMeta, actorName: string): Promise<Activity> {
  const input: RecordActivityInput = {
    leadId,
    // A call: this is a record of a conversation that happened, exactly like a
    // manually logged call, so it reads the same way on the timeline and is
    // picked up by the same "last call/email/message" evidence the brief uses.
    type: "call",
    body: `Call processed with AI: ${meta.summary}`,
    actorName,
    metadata: meta as unknown as Record<string, unknown>,
  };
  return recordActivity(input);
}

export async function getCallRecap(activityId: string): Promise<CallRecapRow | null> {
  const row = await queryOne<{ id: string; lead_id: string; occurred_at: string; metadata: unknown }>(
    `select id, lead_id, occurred_at, metadata from activities where id = $1`,
    [activityId]
  );
  if (!row) return null;
  const meta = toMeta(row.metadata);
  return meta ? { activityId: row.id, leadId: row.lead_id, occurredAt: row.occurred_at, meta } : null;
}

export async function latestCallRecap(leadId: string): Promise<CallRecapRow | null> {
  const rows = await query<{ id: string; lead_id: string; occurred_at: string; metadata: unknown }>(
    `select id, lead_id, occurred_at, metadata from activities
      where lead_id = $1 and metadata->>'kind' = $2
      order by occurred_at desc limit 1`,
    [leadId, CALL_RECAP_KIND]
  );
  if (!rows.length) return null;
  const meta = toMeta(rows[0].metadata);
  return meta ? { activityId: rows[0].id, leadId: rows[0].lead_id, occurredAt: rows[0].occurred_at, meta } : null;
}

export async function listCallRecaps(leadId: string): Promise<CallRecapRow[]> {
  const rows = await query<{ id: string; lead_id: string; occurred_at: string; metadata: unknown }>(
    `select id, lead_id, occurred_at, metadata from activities
      where lead_id = $1 and metadata->>'kind' = $2
      order by occurred_at desc`,
    [leadId, CALL_RECAP_KIND]
  );
  return rows
    .map((r) => {
      const meta = toMeta(r.metadata);
      return meta ? { activityId: r.id, leadId: r.lead_id, occurredAt: r.occurred_at, meta } : null;
    })
    .filter((r): r is CallRecapRow => Boolean(r));
}

export async function patchCallRecap(activityId: string, patch: Partial<CallRecapMeta>): Promise<void> {
  await patchActivityMetadata(activityId, patch as Record<string, unknown>);
}
