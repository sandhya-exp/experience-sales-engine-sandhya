import { queryOne } from "@/lib/db";
import { getLeadById } from "@/lib/repo/leads";
import { getLatestBrief } from "@/lib/repo/aiBriefs";
import { getLeadContextOrThrow, regenerateBriefFor } from "@/lib/ai/service";
import { applyCustomerFacts, autoModeFor, executeAgentAction, primaryContact, proposeAgentAction, type ExecuteResult } from "@/lib/ai/actions";
import { nextMeeting, openQuestions } from "@/lib/ai/act";
import { extractFromReply, planReplyApplication, type ReplyExtraction } from "@/lib/ai/reply";
import { getAgentAction, patchActivityMetadata, patchAgentAction, recordCustomerReply, type AgentActionRow, type CustomerReplyMeta, CUSTOMER_REPLY_KIND } from "@/lib/repo/agentActions";
import { hasIntelligence } from "@/lib/ai/briefGuards";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";

/**
 * The agent loop, in one place.
 *
 * Everything below is composition: the orchestrator still decides what is true,
 * `act.ts` still decides what to do, `actions.ts` still owns the writes. This
 * module is what the application calls, so a server action, the seed script and
 * an eval all drive the identical sequence:
 *
 *   refresh   re-read the opportunity → regenerate intelligence → propose an action
 *   execute   run an approved (or green, automatic) action
 *   reply     take the customer's words → extract → apply → refresh
 *
 * The loop closes because `reply` ends in `refresh`: new information changes the
 * intelligence, which changes the readiness, which changes the action. Nothing
 * special-cases the demo.
 */
export interface RefreshOptions {
  actorName?: string;
  mode?: "auto" | "deterministic";
  now?: Date;
  /** Skip proposing (used where only the brief matters, e.g. just before the handoff). */
  proposeAction?: boolean;
}

export interface RefreshResult {
  intelligence: OpportunityIntelligence | null;
  action: AgentActionRow | null;
  /** Set when a green action ran without a person. */
  executed: ExecuteResult | null;
}

/** Regenerate the intelligence and decide what to do next. */
export async function refreshOpportunity(leadId: string, opts: RefreshOptions = {}): Promise<RefreshResult> {
  const ctx = await getLeadContextOrThrow(leadId);
  const brief = await regenerateBriefFor(ctx);
  const intelligence = hasIntelligence(brief) ? brief.intelligence : null;
  if (!intelligence || opts.proposeAction === false) return { intelligence, action: null, executed: null };

  const senderName = await senderFor(ctx.lead.owner_user_id);
  const action = await proposeAgentAction(
    { lead: ctx.lead, company: ctx.company, contacts: ctx.contacts, activities: ctx.activities, intelligence, now: opts.now },
    { senderName, mode: opts.mode, now: opts.now }
  );
  if (!action) return { intelligence, action: null, executed: null };

  // Automatic execution is opt-in per opportunity and only ever reaches a green
  // action — `executeAgentAction` re-checks the band rather than trusting this.
  let executed: ExecuteResult | null = null;
  if (action.meta.risk === "green" && (await autoModeFor(leadId))) {
    executed = await runAction({ activityId: action.activityId, approvedBy: null, auto: true });
  }
  return { intelligence, action, executed };
}

/**
 * Execute one action. `prepare_call` needs the opportunity's open questions, so
 * they are gathered here rather than trusted from the browser.
 */
export async function runAction(args: {
  activityId: string;
  approvedBy: string | null;
  editedSubject?: string | null;
  editedBody?: string | null;
  auto?: boolean;
  now?: Date;
}): Promise<ExecuteResult> {
  const row = await getAgentAction(args.activityId);
  if (!row) return { ok: false, state: "proposed", delivery: null, detail: "That action no longer exists." };

  let prepare: Parameters<typeof executeAgentAction>[0]["prepare"] = null;
  if (row.meta.action_type === "prepare_call") {
    const ctx = await getLeadContextOrThrow(row.leadId);
    const brief = await getLatestBrief(row.leadId);
    const intel = hasIntelligence(brief) ? brief.intelligence : null;
    const meeting = nextMeeting(ctx.activities, args.now ?? new Date());
    if (meeting && intel) {
      prepare = {
        meetingTitle: meeting.title,
        meetingAt: meeting.at,
        questions: openQuestions(intel).slice(0, 5),
        known: intel.gaps.known.map((k) => `${k.label}: ${k.value}`).slice(0, 6),
      };
    }
  }

  return executeAgentAction({ ...args, prepare });
}

/* --------------------------------------------------------- customer reply */

export interface ReplyResult {
  extraction: ReplyExtraction;
  applied: string[];
  /** The intelligence and action after the reply was taken into account. */
  after: RefreshResult;
  /** Gap labels that were open before and are gone now. */
  resolvedGaps: string[];
  readinessBefore: { passed: number; total: number; ready: boolean } | null;
  readinessAfter: { passed: number; total: number; ready: boolean } | null;
  nextActionBefore: string | null;
  nextActionAfter: string | null;
}

/**
 * The customer answered. Extract what they said, write only what is quoted,
 * then run the whole pipeline again so readiness and the next action move on
 * their own — the before/after is measured here so the UI can show the
 * transition rather than assert it.
 */
export async function handleCustomerReply(args: {
  leadId: string;
  text: string;
  /** The action this answers, when it answers one. */
  inReplyToActivityId?: string | null;
  actorName: string;
  mode?: "auto" | "deterministic";
  now?: Date;
}): Promise<ReplyResult> {
  const before = await getLeadContextOrThrow(args.leadId);
  const beforeBrief = await getLatestBrief(args.leadId);
  const beforeIntel = hasIntelligence(beforeBrief) ? beforeBrief.intelligence : null;
  const contact = primaryContact(before.contacts, before.lead.primary_contact_id);

  const extraction = await extractFromReply({
    replyText: args.text,
    lead: before.lead,
    company: before.company,
    contact,
    intelligence: beforeIntel,
    mode: args.mode,
  });

  const plan = planReplyApplication(extraction, before.lead, args.now);

  const replyMeta: CustomerReplyMeta = {
    kind: CUSTOMER_REPLY_KIND,
    in_reply_to: args.inReplyToActivityId ?? null,
    text: args.text.trim(),
    extracted: [...extraction.facts.map((f) => ({ label: f.label, value: f.value, quote: f.quote })), ...extraction.systems.map((s) => ({ label: "System", value: s.name, quote: s.quote }))],
    applied: plan.applied,
    generated_by: extraction.generated_by,
    model: extraction.model,
  };
  const replyActivity = await recordCustomerReply(args.leadId, replyMeta, contact?.name ?? "Customer");

  await applyCustomerFacts({
    leadId: args.leadId,
    currentQualification: before.lead.qualification ?? {},
    qualificationUpdates: plan.qualificationUpdates,
    contextLines: plan.contextLines,
    actorName: args.actorName,
  });

  // Close the loop on the action that asked the question.
  if (args.inReplyToActivityId) {
    const action = await getAgentAction(args.inReplyToActivityId);
    if (action) {
      await patchAgentAction(args.inReplyToActivityId, {
        replied_at: (args.now ?? new Date()).toISOString(),
        trace: { ...action.meta.trace, result: `${action.meta.trace.result ?? "Executed."} Customer replied: ${extraction.summary || "see the timeline."}` },
      });
    }
  }

  const after = await refreshOpportunity(args.leadId, { mode: args.mode, now: args.now });

  const gapsBefore = (beforeIntel?.gaps.missing ?? []).map((m) => m.label);
  const gapsAfter = (after.intelligence?.gaps.missing ?? []).map((m) => m.label);
  const resolvedGaps = gapsBefore.filter((g) => !gapsAfter.includes(g));
  const readinessBefore = beforeIntel?.readiness ? { passed: beforeIntel.readiness.checks_passed, total: beforeIntel.readiness.checks_total, ready: beforeIntel.readiness.ready } : null;
  const readinessAfter = after.intelligence?.readiness ? { passed: after.intelligence.readiness.checks_passed, total: after.intelligence.readiness.checks_total, ready: after.intelligence.readiness.ready } : null;
  const nextActionBefore = beforeIntel?.next_action.action ?? null;
  const nextActionAfter = after.intelligence?.next_action.action ?? null;

  // Keep the before/after with the reply, so the transition is part of the
  // record rather than something the screen remembered for a moment.
  await patchActivityMetadata(replyActivity.id, {
    transition: {
      resolved_gaps: resolvedGaps,
      readiness_before: readinessBefore ? `${readinessBefore.passed}/${readinessBefore.total}` : null,
      readiness_after: readinessAfter ? `${readinessAfter.passed}/${readinessAfter.total}` : null,
      next_action_before: nextActionBefore,
      next_action_after: nextActionAfter,
    },
  });

  return { extraction, applied: plan.applied, after, resolvedGaps, readinessBefore, readinessAfter, nextActionBefore, nextActionAfter };
}

/* ---------------------------------------------------------------- helpers */

async function senderFor(ownerUserId: string | null): Promise<string> {
  if (!ownerUserId) return "Experience.com Sales";
  const row = await queryOne<{ name: string }>("select name from app_users where id = $1", [ownerUserId]);
  return row?.name ?? "Experience.com Sales";
}

/** Convenience for callers that only have a lead id. */
export async function leadExists(leadId: string) {
  return Boolean(await getLeadById(leadId));
}
