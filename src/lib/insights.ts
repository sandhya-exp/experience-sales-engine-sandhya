import type { BriefRow } from "@/lib/repo/aiBriefs";
import type { LeadListRow } from "@/lib/types";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";
import { needsAttention } from "@/lib/dashboard";

/**
 * Dashboard-level reading of AI Opportunity Intelligence.
 *
 * This file runs no model and changes no AI logic. It reads the briefs the
 * orchestrator already saved (src/lib/ai/orchestrator.ts → ai_deal_briefs) and
 * groups them so Home can answer four questions at a glance: what is missing,
 * what conflicts, what does the AI recommend next, and what is ready for the
 * quote handoff. Clicking anything here opens the opportunity, where the real
 * brief — with its evidence, sources and AI Process panel — lives.
 */
export interface OpportunityInsight {
  lead: LeadListRow;
  brief: BriefRow | null;
  intelligence: OpportunityIntelligence | null;
  /** Qualification fields the AI could not find. */
  missing: string[];
  /** Conflicts between the inquiry and what was qualified. */
  contradictions: { topic: string; action: string }[];
  nextAction: string | null;
  nextActionReason: string | null;
  /** The orchestrator's readiness verdict, when the brief carries one. */
  ready: boolean;
  readinessPassed: number;
  readinessTotal: number;
  attention: string | null;
  mode: "claude" | "deterministic" | null;
}

function intelligenceOf(brief: BriefRow | null): OpportunityIntelligence | null {
  if (!brief) return null;
  const i = brief.intelligence as OpportunityIntelligence;
  return i && typeof i === "object" && "customer_need" in i ? i : null;
}

export function buildInsights(rows: LeadListRow[], briefs: BriefRow[]): OpportunityInsight[] {
  const byLead = new Map(briefs.map((b) => [b.lead_id, b]));
  return rows
    .filter((r) => r.status !== "won" && r.status !== "lost")
    .map((lead) => {
      const brief = byLead.get(lead.id) ?? null;
      const intel = intelligenceOf(brief);
      const readiness = intel?.readiness;
      const attention = needsAttention(lead);
      return {
        lead,
        brief,
        intelligence: intel,
        missing: intel?.gaps?.missing?.map((m) => m.label) ?? brief?.missing_info ?? lead.missing_info ?? [],
        contradictions: (intel?.contradictions ?? []).map((c) => ({ topic: c.topic, action: c.action })),
        nextAction: brief?.next_action ?? lead.next_action ?? null,
        nextActionReason: brief?.next_action_reason ?? null,
        ready: Boolean(readiness?.ready),
        readinessPassed: readiness?.checks_passed ?? 0,
        readinessTotal: readiness?.checks_total ?? 0,
        attention: attention.flagged ? attention.reason ?? "Needs attention" : null,
        mode: intel?.process?.mode ?? null,
      };
    });
}

export interface InsightBuckets {
  all: OpportunityInsight[];
  /** Stalled, missed calls, unqualified — the same rule the pipeline uses. */
  attention: OpportunityInsight[];
  /** Qualification fields the AI flagged as missing, most incomplete first. */
  missingInfo: OpportunityInsight[];
  /** Inquiry vs qualification conflicts the AI detected. */
  contradictions: OpportunityInsight[];
  /** Ready to hand to the quote module. */
  ready: OpportunityInsight[];
  /** Everything with a recommended next action, most urgent stage first. */
  nextActions: OpportunityInsight[];
  /** Opportunities with no brief generated yet. */
  unanalyzed: OpportunityInsight[];
  claudeCount: number;
}

const STAGE_URGENCY: Record<string, number> = { new: 0, contacted: 1, qualified: 2, quoted: 3 };

export function bucketInsights(insights: OpportunityInsight[]): InsightBuckets {
  return {
    all: insights,
    attention: insights.filter((i) => i.attention),
    missingInfo: insights.filter((i) => i.missing.length > 0).sort((a, b) => b.missing.length - a.missing.length),
    contradictions: insights.filter((i) => i.contradictions.length > 0),
    ready: insights.filter((i) => i.ready),
    nextActions: insights
      .filter((i) => i.nextAction)
      .sort(
        (a, b) =>
          Number(Boolean(b.attention)) - Number(Boolean(a.attention)) ||
          (STAGE_URGENCY[a.lead.status] ?? 9) - (STAGE_URGENCY[b.lead.status] ?? 9)
      ),
    unanalyzed: insights.filter((i) => !i.brief),
    claudeCount: insights.filter((i) => i.mode === "claude").length,
  };
}
