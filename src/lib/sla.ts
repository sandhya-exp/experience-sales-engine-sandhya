import type { Activity, Lead } from "@/lib/types";

/**
 * How long a lead may sit with the person who holds it.
 *
 * An inbound enquiry that nobody touches is the most expensive failure in this
 * product — the customer asked, and the answer was silence. So the rule is two
 * stages rather than one: remind the rep first, because the usual cause is a
 * busy week rather than neglect, and only reassign if it is still untouched
 * after the escalation window. Reassigning straight away would punish a rep for
 * a lead that arrived twenty minutes ago.
 *
 * Both thresholds are wall-clock hours from the moment the lead was assigned.
 * Business hours would be more accurate and much less predictable to explain in
 * a demo; the office-hours rule lives in the scheduler, where it decides when a
 * call can happen, which is where it actually matters.
 *
 * Nothing here reads the database or writes anything. It is a pure reading of
 * the timeline, so the same function answers "is this breached" on a page, in
 * the agent's decision, and in a test.
 */
export interface SlaConfig {
  /** Hours before the rep is reminded. */
  respondHours: number;
  /** Hours before the lead is taken off them. */
  reassignHours: number;
}

export function slaConfig(): SlaConfig {
  const respondHours = clamp(process.env.SLA_RESPOND_HOURS, 24, 1, 720);
  const reassignHours = clamp(process.env.SLA_REASSIGN_HOURS, 48, respondHours + 1, 1440);
  return { respondHours, reassignHours };
}

function clamp(v: string | undefined, dflt: number, min: number, max: number) {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

export type SlaState =
  /** Within the window, or already answered. */
  | "ok"
  /** Past the response window: remind the rep. */
  | "breached"
  /** Past the reassignment window: take it off them. */
  | "escalated"
  /** Nothing to measure — no owner, or the deal is closed. */
  | "n/a";

export interface SlaAssessment {
  state: SlaState;
  /** When the current owner got it. */
  assignedAt: string | null;
  /** The last thing the owner personally did on this lead, if anything. */
  lastOwnerTouchAt: string | null;
  /** Whole hours the lead has been sitting untouched by its owner. */
  hoursWaiting: number;
  config: SlaConfig;
}

/** Records the system or the agent wrote. A lead is not "worked" because a robot logged something. */
const AUTOMATED_ACTORS = new Set(["system", "ai agent", "sales engine"]);
const AUTOMATED_KINDS = new Set(["assignment", "agent_action", "agent_auto", "agent_prep", "status_change"]);

/**
 * Did a person actually work this lead after it landed on their desk?
 *
 * Deliberately strict about what counts. An assignment record is the clock
 * starting, not work. An agent action is the agent covering for the rep, which
 * is exactly the situation this is meant to catch. A stage change on its own is
 * bookkeeping. What counts is a call, an email, a message, a note or a
 * qualification update, written by a human.
 */
function isOwnerWork(a: Activity, ownerUserId: string | null): boolean {
  const kind = typeof a.metadata?.kind === "string" ? a.metadata.kind : "";
  if (AUTOMATED_KINDS.has(kind)) return false;
  if (AUTOMATED_ACTORS.has((a.actor_name ?? "").trim().toLowerCase())) return false;
  // Attributed to the owner, or — for records written before actors were
  // linked to accounts — at least to a named person rather than the system.
  if (a.actor_user_id) return a.actor_user_id === ownerUserId;
  return Boolean(a.actor_name);
}

export function assessSla(lead: Lead, activities: Activity[], now = new Date(), config = slaConfig()): SlaAssessment {
  const base: Omit<SlaAssessment, "state"> = { assignedAt: null, lastOwnerTouchAt: null, hoursWaiting: 0, config };

  if (!lead.owner_user_id) return { ...base, state: "n/a" };
  if (lead.status === "won" || lead.status === "lost") return { ...base, state: "n/a" };

  // When this owner got it: the most recent assignment record naming them,
  // falling back to when the lead was created.
  const assignment = [...activities]
    .filter((a) => a.metadata?.kind === "assignment" && a.metadata?.owner_user_id === lead.owner_user_id)
    .sort((a, b) => iso(b.occurred_at).localeCompare(iso(a.occurred_at)))[0];
  const assignedAt = assignment ? iso(assignment.occurred_at) : iso(lead.created_at);

  const lastTouch = [...activities]
    .filter((a) => isOwnerWork(a, lead.owner_user_id) && iso(a.occurred_at) >= assignedAt)
    .sort((a, b) => iso(b.occurred_at).localeCompare(iso(a.occurred_at)))[0];
  if (lastTouch) {
    return { ...base, state: "ok", assignedAt, lastOwnerTouchAt: iso(lastTouch.occurred_at), hoursWaiting: 0 };
  }

  const hoursWaiting = Math.floor((now.getTime() - new Date(assignedAt).getTime()) / 3_600_000);
  const state: SlaState = hoursWaiting >= config.reassignHours ? "escalated" : hoursWaiting >= config.respondHours ? "breached" : "ok";
  return { ...base, state, assignedAt, hoursWaiting };
}

/** "2 days" / "31 hours" — for a sentence a person reads. */
export function describeWaiting(hours: number): string {
  if (hours >= 48) return `${Math.floor(hours / 24)} days`;
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}

function iso(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}
