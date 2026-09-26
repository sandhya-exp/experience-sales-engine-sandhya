import { query, queryOne } from "@/lib/db";
import { recordActivity, type RecordActivityInput } from "@/lib/repo/activities";
import { patchActivityMetadata } from "@/lib/repo/agentActions";
import type { Activity } from "@/lib/types";
import type { ExtractedFact } from "@/lib/ai/reply";

/**
 * An automatically-captured inbound email reply lives on the activity
 * timeline, the same way a pasted call transcript does (`repo/callRecap.ts`)
 * and a manually-submitted reply does (`repo/agentActions.ts`'s
 * `customer_reply`): an `email` activity carrying its structure in
 * `metadata`. No new table — recording it this way is also what makes it
 * show up automatically as evidence the next time the AI brief refreshes,
 * since the brief already reads the opportunity's recent activities.
 *
 * The one thing that makes this different from a manually-submitted reply:
 * a human typing a reply into the Sales Engine and submitting it IS the
 * confirmation that the text is real and worth acting on, so
 * `handleCustomerReply` applies its extraction immediately. A webhook has no
 * such human gate — anything arriving automatically could be malformed,
 * spam, or simply wrong — so this module follows the Call Recap discipline
 * instead: extraction only ever proposes, and a salesperson has to confirm
 * which facts to keep (`confirmed_indices`) before anything is written to
 * the opportunity's qualification or context.
 */
export const INBOUND_REPLY_KIND = "inbound_reply";

export interface InboundReplyMeta {
  kind: typeof INBOUND_REPLY_KIND;
  from_email: string;
  subject: string | null;
  text: string;
  facts: ExtractedFact[];
  systems: { name: string; quote: string }[];
  summary: string;
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

export interface InboundReplyRow {
  activityId: string;
  leadId: string;
  occurredAt: string;
  meta: InboundReplyMeta;
}

function toMeta(raw: unknown): InboundReplyMeta | null {
  const m = raw as InboundReplyMeta | undefined;
  return m && m.kind === INBOUND_REPLY_KIND ? m : null;
}

export async function recordInboundReply(leadId: string, meta: InboundReplyMeta, contactName: string): Promise<Activity> {
  const preview = meta.text.length > 240 ? `${meta.text.slice(0, 239)}…` : meta.text;
  const input: RecordActivityInput = {
    leadId,
    // An email: this reads the same way on the timeline as any other logged
    // email, and is picked up by the same "last call/email/message" evidence
    // the brief uses.
    type: "email",
    body: `Email reply from ${contactName}${meta.subject ? ` — ${meta.subject}` : ""}: ${preview}`,
    actorName: contactName,
    metadata: meta as unknown as Record<string, unknown>,
  };
  return recordActivity(input);
}

export async function getInboundReply(activityId: string): Promise<InboundReplyRow | null> {
  const row = await queryOne<{ id: string; lead_id: string; occurred_at: string; metadata: unknown }>(
    `select id, lead_id, occurred_at, metadata from activities where id = $1`,
    [activityId]
  );
  if (!row) return null;
  const meta = toMeta(row.metadata);
  return meta ? { activityId: row.id, leadId: row.lead_id, occurredAt: row.occurred_at, meta } : null;
}

export async function latestInboundReply(leadId: string): Promise<InboundReplyRow | null> {
  const rows = await query<{ id: string; lead_id: string; occurred_at: string; metadata: unknown }>(
    `select id, lead_id, occurred_at, metadata from activities
      where lead_id = $1 and metadata->>'kind' = $2
      order by occurred_at desc limit 1`,
    [leadId, INBOUND_REPLY_KIND]
  );
  if (!rows.length) return null;
  const meta = toMeta(rows[0].metadata);
  return meta ? { activityId: rows[0].id, leadId: rows[0].lead_id, occurredAt: rows[0].occurred_at, meta } : null;
}

export async function listInboundReplies(leadId: string): Promise<InboundReplyRow[]> {
  const rows = await query<{ id: string; lead_id: string; occurred_at: string; metadata: unknown }>(
    `select id, lead_id, occurred_at, metadata from activities
      where lead_id = $1 and metadata->>'kind' = $2
      order by occurred_at desc`,
    [leadId, INBOUND_REPLY_KIND]
  );
  return rows
    .map((r) => {
      const meta = toMeta(r.metadata);
      return meta ? { activityId: r.id, leadId: r.lead_id, occurredAt: r.occurred_at, meta } : null;
    })
    .filter((r): r is InboundReplyRow => Boolean(r));
}

export async function patchInboundReply(activityId: string, patch: Partial<InboundReplyMeta>): Promise<void> {
  await patchActivityMetadata(activityId, patch as Record<string, unknown>);
}
