import { query, queryOne } from "@/lib/db";
import { recordActivity } from "@/lib/repo/activities";
import type { Activity } from "@/lib/types";
import type { EvidenceItem } from "@/lib/ai/intelligence";
import type { Delivery } from "@/lib/email/provider";

/**
 * Agent actions live on the activity timeline.
 *
 * There is no actions table and there shouldn't be one — the timeline already
 * is the record of what happened on an opportunity, and "the AI asked the
 * customer which listing system they use" is exactly that. The pattern is the
 * one booked calls already use (`metadata.kind = "follow_up"`): a normal
 * activity row carrying its structure in `metadata`.
 *
 * The consequence that matters: an agent action cannot drift from the account
 * history, it appears in the timeline a person reads, and every task derived
 * from it clears itself when the work is done.
 */
export const AGENT_ACTION_KIND = "agent_action";
export const CUSTOMER_REPLY_KIND = "customer_reply";

/** What the agent is allowed to do. Deliberately small and explicit. */
/**
 * A side effect an internal task performs when it runs. Most agent actions are
 * a record and a message; these three change the opportunity itself, so they
 * are named rather than inferred from the wording of a goal.
 */
export type AgentEffect =
  | "reassign" // take the lead off an unresponsive owner and give it to someone free
  | "close_won" // the customer accepted — mark it Won
  | "close_lost"; // silence past the limit — mark it Lost

export type AgentActionType =
  | "ask_customer" // send the customer a grounded question
  | "schedule_follow_up" // put a follow-up on the timeline
  | "prepare_call" // a preparation task before a booked meeting
  | "internal_task"; // something for the salesperson, no customer contact

/**
 * GREEN  safe to execute without a person: internal work and routine,
 *        evidence-backed information requests.
 * YELLOW leaves the building or changes qualification — a person approves it.
 * RED    commercial or contractual ground. Never automatic, ever.
 */
export type AgentRisk = "green" | "yellow" | "red";

export type AgentActionState = "proposed" | "approved" | "executed" | "declined";

export interface AgentDraftMessage {
  to: { name: string | null; email: string };
  subject: string;
  body: string;
  /** How the body was produced, so the UI never claims Claude wrote something it didn't. */
  generated_by: "claude" | "deterministic";
  model: string | null;
}

/** The concise business reasoning a judge can follow — never chain-of-thought. */
export interface AgentTrace {
  trigger: string;
  data_used: string[];
  knowledge: { id: string; title: string }[];
  decision: string;
  result: string | null;
  /** The write tools this action actually invoked, in order. Empty until it executes. */
  tools_invoked?: string[];
}

export interface AgentActionMeta {
  kind: typeof AGENT_ACTION_KIND;
  action_id: string;
  action_type: AgentActionType;
  risk: AgentRisk;
  goal: string;
  rationale: string;
  evidence: EvidenceItem[];
  /** The qualification gap this action exists to close, when there is one. */
  gap_label: string | null;
  draft_message: AgentDraftMessage | null;
  state: AgentActionState;
  delivery: Delivery | null;
  trace: AgentTrace;
  executed_at: string | null;
  /** Set when the customer answered this action. */
  replied_at: string | null;
  /** What running this changes on the opportunity, when it changes anything. */
  effect?: AgentEffect | null;
  auto: boolean;
}

export interface AgentActionRow {
  activityId: string;
  leadId: string;
  occurredAt: string;
  meta: AgentActionMeta;
}

export interface AgentActionListRow extends AgentActionRow {
  companyName: string;
  ownerName: string | null;
  leadStatus: string;
}

function toMeta(raw: unknown): AgentActionMeta | null {
  const m = raw as AgentActionMeta | undefined;
  return m && m.kind === AGENT_ACTION_KIND && m.action_id && m.state ? m : null;
}

/* ------------------------------------------------------------------ writes */

export async function insertAgentAction(leadId: string, meta: AgentActionMeta, actorName: string, body: string): Promise<Activity> {
  return recordActivity({
    leadId,
    // A note: it is something that happened on the account, not a call or an
    // email until the agent actually sends one.
    type: "note",
    body,
    actorName,
    metadata: meta as unknown as Record<string, unknown>,
  });
}

/** Merge a patch into an activity's metadata. Postgres does the merge; nothing is read-modify-written in JS. */
export async function patchActivityMetadata(activityId: string, patch: Record<string, unknown>): Promise<void> {
  await query(`update activities set metadata = metadata || $2::jsonb where id = $1`, [activityId, JSON.stringify(patch)]);
}

export async function patchAgentAction(activityId: string, patch: Partial<AgentActionMeta>): Promise<void> {
  await patchActivityMetadata(activityId, patch as Record<string, unknown>);
}

/**
 * Retire any proposal that is still only proposed. Called before a new one is
 * written, so an opportunity never carries two competing suggestions. Actions
 * that were approved, executed or declined are history and are left alone.
 */
export async function supersedeProposedActions(leadId: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `update activities
        set metadata = metadata || '{"state":"declined","superseded":true}'::jsonb
      where lead_id = $1
        and metadata->>'kind' = $2
        and metadata->>'state' = 'proposed'
      returning id`,
    [leadId, AGENT_ACTION_KIND]
  );
  return rows.length;
}

/* ------------------------------------------------------------------- reads */

export async function listAgentActionsForLead(leadId: string): Promise<AgentActionRow[]> {
  const rows = await query<{ id: string; lead_id: string; occurred_at: string; metadata: unknown }>(
    `select id, lead_id, occurred_at, metadata from activities
      where lead_id = $1 and metadata->>'kind' = $2
      order by occurred_at desc`,
    [leadId, AGENT_ACTION_KIND]
  );
  return rows
    .map((r) => {
      const meta = toMeta(r.metadata);
      return meta ? { activityId: r.id, leadId: r.lead_id, occurredAt: r.occurred_at, meta } : null;
    })
    .filter((r): r is AgentActionRow => Boolean(r));
}

/** The one action a salesperson is being asked about right now, if any. */
export async function currentAgentActionFor(leadId: string): Promise<AgentActionRow | null> {
  const all = await listAgentActionsForLead(leadId);
  return all.find((a) => a.meta.state === "proposed" || a.meta.state === "approved") ?? all.find((a) => a.meta.state === "executed" && !a.meta.replied_at) ?? all[0] ?? null;
}

export async function getAgentAction(activityId: string): Promise<AgentActionRow | null> {
  const row = await queryOne<{ id: string; lead_id: string; occurred_at: string; metadata: unknown }>(
    `select id, lead_id, occurred_at, metadata from activities where id = $1`,
    [activityId]
  );
  if (!row) return null;
  const meta = toMeta(row.metadata);
  return meta ? { activityId: row.id, leadId: row.lead_id, occurredAt: row.occurred_at, meta } : null;
}

/** Every open agent action across the pipeline — what Home counts. */
export async function listOpenAgentActions(limit = 200): Promise<AgentActionListRow[]> {
  const rows = await query<{
    id: string;
    lead_id: string;
    occurred_at: string;
    metadata: unknown;
    company_name: string;
    owner_name: string | null;
    lead_status: string;
  }>(
    `select a.id, a.lead_id, a.occurred_at, a.metadata,
            c.name as company_name, u.name as owner_name, l.status as lead_status
       from activities a
       join leads l on l.id = a.lead_id
       join companies c on c.id = l.company_id
       left join app_users u on u.id = l.owner_user_id
      where a.metadata->>'kind' = $1
        and l.status not in ('won', 'lost')
      order by a.occurred_at desc
      limit $2`,
    [AGENT_ACTION_KIND, limit]
  );
  return rows
    .map((r) => {
      const meta = toMeta(r.metadata);
      return meta
        ? { activityId: r.id, leadId: r.lead_id, occurredAt: r.occurred_at, meta, companyName: r.company_name, ownerName: r.owner_name, leadStatus: r.lead_status }
        : null;
    })
    .filter((r): r is AgentActionListRow => Boolean(r));
}

export interface AgentActionCounts {
  waitingApproval: number;
  handledAutomatically: number;
  waitingCustomer: number;
  total: number;
}

/**
 * The operational states Home shows. One pass over the open actions, keeping
 * only the newest per opportunity per state so a long history doesn't inflate
 * the counts.
 */
export function countAgentActions(rows: AgentActionListRow[]): AgentActionCounts {
  const waitingApproval = rows.filter((r) => r.meta.state === "proposed" && r.meta.risk !== "green").length;
  const handledAutomatically = rows.filter((r) => r.meta.state === "executed" && r.meta.auto).length;
  const waitingCustomer = rows.filter((r) => r.meta.state === "executed" && r.meta.action_type === "ask_customer" && !r.meta.replied_at).length;
  return { waitingApproval, handledAutomatically, waitingCustomer, total: rows.length };
}

/* ---------------------------------------------------------- customer reply */

export interface CustomerReplyMeta {
  kind: typeof CUSTOMER_REPLY_KIND;
  in_reply_to: string | null;
  text: string;
  /** What the extraction pulled out, each tied to the customer's own words. */
  extracted: { label: string; value: string; quote: string }[];
  /** What was written to the opportunity as a result. */
  applied: string[];
  generated_by: "claude" | "deterministic";
  model: string | null;
  /**
   * What changed because of this reply, measured before and after the pipeline
   * ran again. Stored rather than computed on render so the transition is still
   * there tomorrow — a claim about what the agent achieved should survive a
   * page refresh.
   */
  transition?: {
    resolved_gaps: string[];
    readiness_before: string | null;
    readiness_after: string | null;
    next_action_before: string | null;
    next_action_after: string | null;
  };
}

export async function latestCustomerReply(leadId: string): Promise<{ activityId: string; occurredAt: string; meta: CustomerReplyMeta } | null> {
  const rows = await query<{ id: string; occurred_at: string; metadata: unknown }>(
    `select id, occurred_at, metadata from activities
      where lead_id = $1 and metadata->>'kind' = $2
      order by occurred_at desc limit 1`,
    [leadId, CUSTOMER_REPLY_KIND]
  );
  return rows.length ? { activityId: rows[0].id, occurredAt: rows[0].occurred_at, meta: rows[0].metadata as CustomerReplyMeta } : null;
}

export async function recordCustomerReply(leadId: string, meta: CustomerReplyMeta, contactName: string): Promise<Activity> {
  return recordActivity({
    leadId,
    type: "message",
    body: `Reply from ${contactName}: ${meta.text}`,
    actorName: contactName,
    metadata: meta as unknown as Record<string, unknown>,
  });
}

export async function listCustomerReplies(leadId: string): Promise<{ activityId: string; occurredAt: string; meta: CustomerReplyMeta }[]> {
  const rows = await query<{ id: string; occurred_at: string; metadata: unknown }>(
    `select id, occurred_at, metadata from activities
      where lead_id = $1 and metadata->>'kind' = $2
      order by occurred_at desc`,
    [leadId, CUSTOMER_REPLY_KIND]
  );
  return rows.map((r) => ({ activityId: r.id, occurredAt: r.occurred_at, meta: r.metadata as CustomerReplyMeta }));
}
