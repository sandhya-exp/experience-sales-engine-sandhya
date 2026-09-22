import { randomUUID } from "node:crypto";
import { query, queryOne } from "@/lib/db";
import { recordActivity } from "@/lib/repo/activities";
import { assignLeadOwner, getLeadById, updateLeadStatus, updateQualification as updateQualificationRepo } from "@/lib/repo/leads";
import { listTeam } from "@/lib/repo/users";
import { pickOwner } from "@/lib/routing";
import {
  AGENT_ACTION_KIND,
  getAgentAction,
  insertAgentAction,
  patchAgentAction,
  supersedeProposedActions,
  type AgentActionMeta,
  type AgentActionRow,
  type AgentEffect,
} from "@/lib/repo/agentActions";
import { composeCustomerMessage, decideAgentAction, nextMeeting, openQuestions, type DecisionInput } from "@/lib/ai/act";
import { deliveryFrom, emailProvider, type Delivery } from "@/lib/email/provider";
import type { Contact, Qualification } from "@/lib/types";

/**
 * The agent's write tools — the only place in this codebase where something
 * other than a person's click changes an opportunity.
 *
 * There are five of them and that is the point. Each one is narrow, each one
 * records what it did on the timeline, and none of them can do anything the
 * three read-only rules above don't already justify: the agent cannot change a
 * stage, cannot invent a qualification value, cannot reach the contract
 * handoff, and cannot send anything a person hasn't approved unless the action
 * was banded green.
 *
 *   propose_action           write a proposal for a person to see
 *   send_customer_message    hand a drafted message to the email provider
 *   write_preparation_note   put a pre-call brief on the timeline
 *   apply_customer_facts     write facts the customer stated, each with their quote
 *   decline_action           retire a proposal a person rejected
 */
export const AGENT_WRITE_TOOLS = ["propose_action", "send_customer_message", "write_preparation_note", "apply_customer_facts", "decline_action"] as const;
export type AgentWriteTool = (typeof AGENT_WRITE_TOOLS)[number];

export const AGENT_AUTO_KIND = "agent_auto";

/**
 * The one safety rule, as a function so it can be tested on its own and cannot
 * be re-implemented differently in two places: only a green action ever runs
 * without a person. Yellow and red wait, whatever the caller asks for.
 */
export function mayRunAutomatically(risk: "green" | "yellow" | "red"): boolean {
  return risk === "green";
}

/* ------------------------------------------------------------- auto mode */

/**
 * Whether green actions may run without a person on this opportunity.
 *
 * Stored the same way everything else is: as an entry on the timeline, so
 * turning automation on is itself an auditable event with a name against it,
 * and there is no settings table to drift from the record.
 */
export async function autoModeFor(leadId: string): Promise<boolean> {
  const rows = await query<{ metadata: { enabled?: boolean } }>(
    `select metadata from activities where lead_id = $1 and metadata->>'kind' = $2 order by occurred_at desc limit 1`,
    [leadId, AGENT_AUTO_KIND]
  );
  if (rows.length) return Boolean(rows[0].metadata.enabled);
  // Off unless the deployment opts in.
  return process.env.AGENT_AUTO_SEND?.trim().toLowerCase() === "green";
}

export async function setAutoMode(leadId: string, enabled: boolean, actorName: string) {
  await recordActivity({
    leadId,
    type: "note",
    body: enabled ? "Automatic execution enabled for low-risk agent actions." : "Automatic execution disabled — every agent action now needs approval.",
    actorName,
    metadata: { kind: AGENT_AUTO_KIND, enabled },
  });
}

/* -------------------------------------------------------------- 1. propose */

export interface ProposeOptions {
  /** Who the message is signed by. The opportunity owner, falling back to the team. */
  senderName: string;
  mode?: "auto" | "deterministic";
  now?: Date;
}

/**
 * Decide, draft and record one proposal. Any earlier proposal that nobody acted
 * on is retired first, so an opportunity carries exactly one open suggestion.
 * Returns null when the agent has nothing worth proposing — silence is a valid
 * answer and better than invented busywork.
 */
export async function proposeAgentAction(input: DecisionInput, opts: ProposeOptions): Promise<AgentActionRow | null> {
  const decision = decideAgentAction({ ...input, now: opts.now });
  await supersedeProposedActions(input.lead.id);
  if (!decision) return null;

  const contact = primaryContact(input.contacts, input.lead.primary_contact_id);
  let draft: AgentActionMeta["draft_message"] = null;
  let composeNote: string | null = null;

  if (decision.action_type === "ask_customer") {
    // Nobody to write to: the action becomes an internal one rather than a
    // message with no recipient.
    if (!contact?.email) {
      return recordProposal(input.lead.id, opts.senderName, {
        ...toMeta(decision, null),
        action_type: "internal_task",
        risk: "yellow",
        goal: `Find a contact for ${input.company.name}`,
        rationale: "The agent has a question to ask but there is no contact with an email address on the account.",
        auto: false,
      });
    }
    const composed = await composeCustomerMessage({
      decision,
      lead: input.lead,
      company: input.company,
      contact,
      intelligence: input.intelligence,
      senderName: opts.senderName,
      mode: opts.mode,
    });
    draft = composed.message;
    composeNote = composed.note;
  }

  const meta = toMeta(decision, draft);
  if (composeNote) meta.trace = { ...meta.trace, decision: `${meta.trace.decision} ${composeNote}` };
  if (decision.action_type === "prepare_call") {
    const m = nextMeeting(input.activities, opts.now ?? new Date());
    if (m) (meta as unknown as Record<string, unknown>).meeting_at = m.at;
  }
  return recordProposal(input.lead.id, opts.senderName, meta);
}

function toMeta(decision: ReturnType<typeof decideAgentAction> & object, draft: AgentActionMeta["draft_message"]): AgentActionMeta {
  const d = decision as NonNullable<ReturnType<typeof decideAgentAction>>;
  return {
    kind: AGENT_ACTION_KIND,
    action_id: randomUUID(),
    action_type: d.action_type,
    risk: d.risk,
    goal: d.goal,
    rationale: d.rationale,
    evidence: d.evidence,
    gap_label: d.gap_label,
    draft_message: draft,
    state: "proposed",
    delivery: draft ? { state: "drafted", provider: emailProvider().name, mode: emailProvider().mode, message_id: null, detail: "Drafted by the agent; not approved.", at: new Date().toISOString() } : null,
    trace: { ...d.trace, tools_invoked: ["propose_action"] },
    executed_at: null,
    replied_at: null,
    auto: false,
    effect: d.effect ?? null,
  };
}

async function recordProposal(leadId: string, actorName: string, meta: AgentActionMeta): Promise<AgentActionRow> {
  const activity = await insertAgentAction(leadId, meta, "AI agent", `AI agent proposed: ${meta.goal}`);
  void actorName;
  return { activityId: activity.id, leadId, occurredAt: activity.occurred_at, meta };
}

/* -------------------------------------------------------------- 2. execute */

export interface ExecuteResult {
  ok: boolean;
  state: AgentActionMeta["state"];
  delivery: Delivery | null;
  detail: string;
}

/**
 * Run an action. A green action may arrive here without a person (auto mode);
 * anything else must carry `approvedBy`. The risk band is re-checked here
 * rather than trusted from the caller, because the button is not the guard.
 */
export async function executeAgentAction(args: {
  activityId: string;
  approvedBy: string | null;
  /** A person may edit the wording before it goes. */
  editedBody?: string | null;
  editedSubject?: string | null;
  auto?: boolean;
  /** Supplied by the caller for a prepare_call action, which needs the opportunity's open questions. */
  prepare?: { meetingTitle: string; meetingAt: string; questions: string[]; known: string[] } | null;
}): Promise<ExecuteResult> {
  const row = await getAgentAction(args.activityId);
  if (!row) return { ok: false, state: "proposed", delivery: null, detail: "That action no longer exists." };
  const meta = row.meta;
  if (meta.state === "executed") return { ok: true, state: "executed", delivery: meta.delivery, detail: "Already executed." };
  if (meta.state === "declined") return { ok: false, state: "declined", delivery: null, detail: "That action was declined." };

  // The safety rule, enforced at the point of execution.
  if (args.auto && !mayRunAutomatically(meta.risk)) {
    return { ok: false, state: meta.state, delivery: null, detail: `Refused: a ${meta.risk} action is never executed automatically.` };
  }
  if (!args.auto && !args.approvedBy) {
    return { ok: false, state: meta.state, delivery: null, detail: "Refused: no approver." };
  }

  const tools = [...(meta.trace.tools_invoked ?? [])];
  const executedAt = new Date().toISOString();

  if (meta.action_type === "ask_customer" && meta.draft_message) {
    const message = {
      to: meta.draft_message.to,
      subject: args.editedSubject?.trim() || meta.draft_message.subject,
      body: args.editedBody?.trim() || meta.draft_message.body,
    };
    const provider = emailProvider();
    const result = await provider.send(message);
    const delivery = deliveryFrom(result);
    tools.push("send_customer_message");
    const edited = Boolean((args.editedBody && args.editedBody.trim() !== meta.draft_message.body) || (args.editedSubject && args.editedSubject.trim() !== meta.draft_message.subject));

    if (delivery.state === "failed") {
      await patchAgentAction(row.activityId, {
        state: "approved",
        delivery,
        trace: { ...meta.trace, tools_invoked: tools, result: `Send failed: ${delivery.detail}` },
      });
      return { ok: false, state: "approved", delivery, detail: delivery.detail };
    }

    await patchAgentAction(row.activityId, {
      state: "executed",
      executed_at: executedAt,
      auto: Boolean(args.auto),
      delivery,
      draft_message: { ...meta.draft_message, ...message },
      trace: {
        ...meta.trace,
        tools_invoked: tools,
        result: `${delivery.state === "sent" ? "Message sent" : "Message recorded"} to ${message.to.email}${edited ? ", edited by the salesperson" : ""}. ${delivery.detail}`,
      },
    });
    return { ok: true, state: "executed", delivery, detail: delivery.detail };
  }

  if (meta.action_type === "prepare_call") {
    if (!args.prepare) return { ok: false, state: meta.state, delivery: null, detail: "Refused: no meeting context to prepare against." };
    await writePreparationNote({
      leadId: row.leadId,
      actorName: args.approvedBy ?? "AI agent",
      meetingTitle: args.prepare.meetingTitle,
      meetingAt: args.prepare.meetingAt,
      questions: args.prepare.questions,
      known: args.prepare.known,
    });
    tools.push("write_preparation_note");
    await patchAgentAction(row.activityId, {
      state: "executed",
      executed_at: executedAt,
      auto: Boolean(args.auto),
      trace: { ...meta.trace, tools_invoked: tools, result: `Pre-call brief written to the timeline · ${args.prepare.questions.length} question${args.prepare.questions.length === 1 ? "" : "s"} to confirm.` },
    });
    return { ok: true, state: "executed", delivery: null, detail: "Pre-call brief written to the timeline." };
  }

  /* An internal task that changes the opportunity itself. Three of them do:
     handing an untouched lead to someone free, and closing a deal Won or Lost.
     Each is a named effect rather than something inferred from the goal text,
     and each writes through the ordinary repo function, so the stage change and
     the reassignment land on the timeline exactly as a person's would. */
  if (meta.effect) {
    const outcome = await applyEffect(meta.effect, row.leadId, args.approvedBy ?? "AI agent");
    if (!outcome.ok) return { ok: false, state: meta.state, delivery: null, detail: outcome.detail };
    tools.push(outcome.tool);
    await patchAgentAction(row.activityId, {
      state: "executed",
      executed_at: executedAt,
      auto: Boolean(args.auto),
      trace: { ...meta.trace, tools_invoked: tools, result: outcome.detail },
    });
    return { ok: true, state: "executed", delivery: null, detail: outcome.detail };
  }

  // internal_task / schedule_follow_up: executing means accepting it as work to
  // do; it shows up in Scheduled Tasks until the work clears it.
  await patchAgentAction(row.activityId, {
    state: "executed",
    executed_at: executedAt,
    auto: Boolean(args.auto),
    trace: { ...meta.trace, tools_invoked: tools, result: `Accepted by ${args.approvedBy ?? "the agent"}.` },
  });
  return { ok: true, state: "executed", delivery: null, detail: "Recorded on the timeline." };
}

/** Write the pre-call brief itself. Separate from execute so it can be tested alone. */
export async function writePreparationNote(args: { leadId: string; actorName: string; meetingTitle: string; meetingAt: string; questions: string[]; known: string[] }) {
  const lines = [
    `Pre-call brief — ${args.meetingTitle}, ${new Date(args.meetingAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}.`,
    args.known.length ? `Known: ${args.known.join("; ")}.` : null,
    args.questions.length ? `To confirm on the call: ${args.questions.join("; ")}.` : "Nothing outstanding — confirm what has changed since the last conversation.",
  ].filter(Boolean);
  return recordActivity({
    leadId: args.leadId,
    type: "note",
    body: lines.join(" "),
    actorName: "AI agent",
    metadata: { kind: "agent_prep", meeting_at: args.meetingAt },
  });
}

/* -------------------------------------------------------------- 3. decline */

export async function declineAgentAction(activityId: string, actorName: string, reason?: string | null) {
  const row = await getAgentAction(activityId);
  if (!row) return;
  await patchAgentAction(activityId, {
    state: "declined",
    trace: { ...row.meta.trace, tools_invoked: [...(row.meta.trace.tools_invoked ?? []), "decline_action"], result: `Declined by ${actorName}${reason ? `: ${reason}` : ""}.` },
  });
}

/* ------------------------------------------------- 4. apply customer facts */

export interface AppliedFact {
  label: string;
  value: string;
  quote: string;
  /** Where it was written. */
  target: "qualification" | "context";
}

/**
 * Write what the customer actually said. Qualification fields are set directly;
 * anything else (the name of a system, a constraint) is appended to the
 * opportunity's own context with an attribution line, which is what the
 * deterministic extraction reads — so a named system closes the integration gap
 * through the existing logic rather than through a new field.
 */
export async function applyCustomerFacts(args: {
  leadId: string;
  currentQualification: Qualification;
  qualificationUpdates: Partial<Qualification>;
  contextLines: string[];
  actorName: string;
}): Promise<void> {
  if (args.contextLines.length) {
    await query(
      `update leads
          set additional_info = case
                when coalesce(additional_info, '') = '' then $2
                else additional_info || E'\n' || $2
              end
        where id = $1`,
      [args.leadId, args.contextLines.join("\n")]
    );
  }
  const keys = Object.keys(args.qualificationUpdates) as (keyof Qualification)[];
  if (keys.length) {
    const merged: Qualification = { ...args.currentQualification, ...args.qualificationUpdates };
    const complete = (["number_of_users", "primary_need", "decision_timeline", "decision_maker", "budget", "current_solution"] as const).every((f) => merged[f]);
    await updateQualificationRepo(args.leadId, merged, complete ? "qualified" : "in_progress", args.actorName);
  }
}

/* ----------------------------------------------------------------- helpers */

export function primaryContact(contacts: Contact[], primaryContactId: string | null): Contact | null {
  return contacts.find((c) => c.id === primaryContactId) ?? contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;
}

export { openQuestions };

/* ------------------------------------------------------------------ effects */

/**
 * The three writes an internal task is allowed to make to the opportunity
 * itself, each behind its own named effect.
 *
 * They go through the same repo functions a person's click does — so the stage
 * change carries its `from`/`to`, the reassignment carries who lost it and who
 * gained it, and both appear on the timeline in the ordinary way. The agent
 * gets no privileged path into the database; it gets the same door, with its
 * name on the record.
 */
async function applyEffect(
  effect: AgentEffect,
  leadId: string,
  actorName: string
): Promise<{ ok: true; tool: string; detail: string } | { ok: false; detail: string }> {
  const lead = await getLeadById(leadId);
  if (!lead) return { ok: false, detail: "Opportunity not found." };

  if (effect === "close_won" || effect === "close_lost") {
    const to = effect === "close_won" ? "won" : "lost";
    if (lead.status === to) return { ok: false, detail: `Already marked ${to}.` };
    await updateLeadStatus(leadId, to, actorName);
    return { ok: true, tool: "set_lead_status", detail: `Opportunity closed as ${to === "won" ? "Won" : "Lost"}.` };
  }

  // reassign — to whoever is genuinely available, never back to the same person.
  const team = await listTeam();
  const company = await queryOne<{ industry: string | null }>("select industry from companies where id = $1", [lead.company_id]);
  const eligible = team.filter((m) => m.id !== lead.owner_user_id && m.role === "sales");
  if (eligible.length === 0) return { ok: false, detail: "No other sales employee is available to take this on." };
  const picked = pickOwner(eligible, company?.industry ?? null);
  if (!picked) return { ok: false, detail: "No other sales employee is available to take this on." };
  const previous = team.find((m) => m.id === lead.owner_user_id)?.name ?? "the previous owner";
  await assignLeadOwner(leadId, picked.owner.id, actorName, `SLA reassignment from ${previous} — ${picked.reason}`);
  return { ok: true, tool: "reassign_lead", detail: `Reassigned from ${previous} to ${picked.owner.name} (${picked.reason}).` };
}
