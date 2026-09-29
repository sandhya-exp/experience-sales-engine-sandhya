import type { Activity, AiDealBrief, Lead } from "@/lib/types";

/**
 * Is the AI Deal Brief current with the record it describes?
 *
 * Derived, never stored: the brief carries `generated_at`, and every change a
 * person (or the customer, or an integration) makes to the opportunity lands
 * as a lead update or an activity row with a timestamp. If anything of that
 * kind is newer than the brief, the brief is behind.
 *
 * The agent's own writes are excluded — its proposals and notes are produced
 * *by* the refresh and are always newer than the brief they came from.
 */
const AI_ACTOR = "AI agent";
const AI_KINDS = new Set(["agent_action", "approval_request", "quote_prep", "deal_history"]);
/** Clock skew between the app and the database. */
const TOLERANCE_MS = 2_000;
/** After this long with no new brief, assume the background run failed and say so. */
const UPDATING_WINDOW_MS = 3 * 60_000;

export type IntelligenceState =
  | { state: "fresh"; since: null }
  | { state: "updating"; since: Date }
  | { state: "stale"; since: Date };

export function lastRecordChange(lead: Pick<Lead, "updated_at" | "created_at">, activities: Activity[]): Date {
  let latest = new Date(lead.updated_at ?? lead.created_at).getTime();
  for (const a of activities) {
    if (a.actor_name === AI_ACTOR) continue;
    const kind = typeof a.metadata?.kind === "string" ? a.metadata.kind : null;
    if (kind && AI_KINDS.has(kind)) continue;
    const t = new Date(a.occurred_at).getTime();
    if (t > latest) latest = t;
  }
  return new Date(latest);
}

export function intelligenceState(
  lead: Pick<Lead, "updated_at" | "created_at">,
  activities: Activity[],
  brief: Pick<AiDealBrief, "generated_at"> | null,
  now: Date = new Date()
): IntelligenceState {
  const changed = lastRecordChange(lead, activities);
  const briefAt = brief ? new Date(brief.generated_at).getTime() : 0;
  if (briefAt + TOLERANCE_MS >= changed.getTime()) return { state: "fresh", since: null };
  return now.getTime() - changed.getTime() < UPDATING_WINDOW_MS ? { state: "updating", since: changed } : { state: "stale", since: changed };
}

/** True when a caller that *needs* a current brief (the contract handoff) must regenerate first. */
export function briefIsStale(lead: Pick<Lead, "updated_at" | "created_at">, activities: Activity[], brief: Pick<AiDealBrief, "generated_at"> | null): boolean {
  return intelligenceState(lead, activities, brief).state !== "fresh";
}
