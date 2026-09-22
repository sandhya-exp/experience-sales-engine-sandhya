import type { Activity, Company, Contact, Lead } from "@/lib/types";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";
import { integrationKind, mentionsIntegration } from "@/lib/ai/intelligence";
import { callClaudeJson, claudeAvailable, claudeModel } from "@/lib/ai/claude";
import { corpusFrom, groundingProblem, inventedProperNouns } from "@/lib/ai/guard";
import { FOLLOW_UP_KIND } from "@/lib/repo/followups";
import { assessSla, describeWaiting } from "@/lib/sla";
import { QUOTE_KIND } from "@/lib/repo/quotes";
import type { AgentActionType, AgentDraftMessage, AgentEffect, AgentRisk, AgentTrace } from "@/lib/repo/agentActions";
import type { EvidenceItem } from "@/lib/ai/intelligence";

/**
 * Stage 4 — Act.
 *
 * The first three stages (orchestrator.ts) decide what is true about an
 * opportunity: what the customer needs, what the knowledge base says, what is
 * missing, whether it is ready. This stage decides what to DO about it, and is
 * deliberately a separate module: the orchestrator is unchanged, the nine
 * existing eval cases still describe it exactly, and the decision here is a
 * pure function of the intelligence the orchestrator already produced.
 *
 *   intelligence ─► pick the one action that unblocks this deal
 *                ─► band it by risk (what may run without a person)
 *                ─► draft the customer message, grounded and guarded
 *                ─► hand it to the caller to persist and, if safe, execute
 *
 * Nothing here writes. It returns a decision; `src/lib/ai/actions.ts` is the
 * only place that turns one into a record.
 */
export interface AgentDecision {
  action_type: AgentActionType;
  risk: AgentRisk;
  /** The objective, in the salesperson's language. */
  goal: string;
  /** Why this action and not another — one sentence, business reasoning. */
  rationale: string;
  evidence: EvidenceItem[];
  gap_label: string | null;
  /** The question to put to the customer, when the action is to ask one. */
  question: string | null;
  trace: AgentTrace;
  /** Whether this may run without a person, before any content check. */
  auto_safe: boolean;
  /** What running this changes on the opportunity, when it changes anything. */
  effect?: AgentEffect | null;
}

export interface DecisionInput {
  lead: Lead;
  company: Company;
  contacts: Contact[];
  activities: Activity[];
  intelligence: OpportunityIntelligence;
  now?: Date;
}

/* --------------------------------------------------------------- risk model */

/**
 * GREEN  internal work, and routine requests for a non-sensitive fact the
 *        customer already implied they would supply (which system, how many
 *        locations, what they use today).
 * YELLOW anything needing interpretation or touching the relationship —
 *        the decision maker, the timeline, which capability matters most,
 *        confirming a conflict.
 * RED    commercial or contractual ground. Budget included: asking a customer
 *        about money is a commercial conversation a person owns.
 */
/**
 * How far ahead a booked call still earns a preparation brief. Set to the
 * booking horizon a customer can reach (about a working week), so a call is
 * prepared as soon as it is booked rather than the night before.
 */
const PREP_HORIZON_HOURS = 8 * 24;

/**
 * How long a quote may sit with a customer in silence before the agent
 * proposes closing the deal as Lost. Long enough that a holiday or a budget
 * cycle doesn't kill a live deal; short enough that the pipeline reflects
 * reality. Proposed, never automatic — a person decides to give up.
 */
const STALE_QUOTE_DAYS = clampDays(process.env.QUOTE_SILENCE_LOST_DAYS, 21, 7, 180);

function clampDays(v: string | undefined, dflt: number, min: number, max: number) {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}

/**
 * A customer reply with nothing logged after it.
 *
 * Replies are recorded by the agent's own reply loop as `customer_reply` rows,
 * so "did anyone answer" is simply whether a person wrote anything later.
 */
function isoOf(v: unknown): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function unansweredCustomerReply(activities: Activity[]): { at: string } | null {
  const replies = activities
    .filter((a) => a.metadata?.kind === "customer_reply")
    .map((a) => ({ at: isoOf(a.occurred_at) }))
    .sort((a, b) => b.at.localeCompare(a.at));
  const latest = replies[0];
  if (!latest) return null;
  const answered = activities.some((a) => {
    const at = isoOf(a.occurred_at);
    const kind = typeof a.metadata?.kind === "string" ? a.metadata.kind : "";
    const automated = kind === "customer_reply" || kind === "agent_action" || (a.actor_name ?? "").toLowerCase() === "system";
    return !automated && at > latest.at;
  });
  return answered ? null : latest;
}

const RISK_BY_FIELD: Record<string, AgentRisk> = {
  number_of_users: "green",
  current_solution: "green",
  primary_need: "yellow",
  decision_timeline: "yellow",
  decision_maker: "yellow",
  contact: "yellow",
  budget: "red",
};

export const RISK_LABEL: Record<AgentRisk, string> = { green: "Low", yellow: "Needs approval", red: "Approval required" };

export const RISK_EXPLANATION: Record<AgentRisk, string> = {
  green: "Routine, factual and evidence-backed — safe to run without a person.",
  yellow: "Interpretation or customer relationship involved — a person approves it before it goes out.",
  red: "Commercial ground (pricing, budget, terms or commitments) — never automatic.",
};

/* ------------------------------------------------------------ the decision */

export function decideAgentAction(input: DecisionInput): AgentDecision | null {
  const { lead, company, contacts, activities, intelligence } = input;
  const now = input.now ?? new Date();

  // A closed deal is done. A *quoted* one is not: negotiation, re-quotes and
  // the close itself all happen at Ready to Contract, and those are exactly the
  // moments a salesperson most wants the agent watching.
  if (lead.status === "won" || lead.status === "lost") return null;

  const primary = contacts.find((c) => c.id === lead.primary_contact_id) ?? contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;
  const who = primary?.name ?? "the customer";
  const inquiryText = [lead.requirements, lead.additional_info].filter(Boolean).join(" ");
  const retrieved = (intelligence.process?.retrieved ?? []).map((r) => ({ id: r.id, title: r.title }));
  const evidence = (intelligence.evidence ?? []).slice(0, 4);
  const dataUsed = ["Customer inquiry", "Qualification", ...(contacts.length ? [`${contacts.length} contact${contacts.length === 1 ? "" : "s"}`] : []), ...(activities.length ? [`${activities.length} timeline entries`] : [])];

  const quote = latestQuote(activities);

  /* 0. Nobody is working this lead.
   *
   * First, because everything below assumes someone is. A customer who asked and
   * got silence is the worst outcome this product can produce, so the agent
   * reminds the rep, and — if it is still untouched after the escalation
   * window — takes it off them and gives it to someone free. The reassignment
   * is the system applying a stated rule, which is why it is green: no
   * judgement, no customer contact, and the whole thing is on the timeline. */
  const sla = assessSla(lead, activities, now);
  if (sla.state === "escalated") {
    return {
      action_type: "internal_task",
      risk: "green",
      goal: `Reassign ${company.name} — untouched for ${describeWaiting(sla.hoursWaiting)}`,
      rationale: `Nobody has worked this since it was assigned ${describeWaiting(sla.hoursWaiting)} ago, past the ${sla.config.reassignHours}-hour limit. It goes to whoever is free, so the customer stops waiting.`,
      evidence,
      gap_label: null,
      question: null,
      trace: {
        trigger: `No owner activity for ${describeWaiting(sla.hoursWaiting)}.`,
        data_used: [...dataUsed, "Assignment history"],
        knowledge: [],
        decision: `Past the ${sla.config.reassignHours}h reassignment window → hand it to an available rep.`,
        result: null,
      },
      auto_safe: true,
      effect: "reassign",
    };
  }
  if (sla.state === "breached") {
    return {
      action_type: "internal_task",
      risk: "green",
      goal: `Remind the owner — ${company.name} has waited ${describeWaiting(sla.hoursWaiting)}`,
      rationale: `The response window is ${sla.config.respondHours} hours and nothing has been logged. A reminder now avoids the reassignment at ${sla.config.reassignHours} hours.`,
      evidence,
      gap_label: null,
      question: null,
      trace: {
        trigger: `No owner activity for ${describeWaiting(sla.hoursWaiting)}.`,
        data_used: [...dataUsed, "Assignment history"],
        knowledge: [],
        decision: `Past the ${sla.config.respondHours}h response window, inside the ${sla.config.reassignHours}h reassignment window → remind first.`,
        result: null,
      },
      auto_safe: true,
    };
  }

  /* 1. The customer answered and nobody has replied.
   *
   * A reply sitting unanswered is a live conversation going cold, so it
   * outranks every internal task below. The agent drafts the response; a person
   * reads it and sends it, because replying in the customer's own thread is
   * relationship ground rather than a routine factual request. */
  const unanswered = unansweredCustomerReply(activities);
  if (unanswered) {
    return {
      action_type: "ask_customer",
      risk: "yellow",
      goal: `Reply to ${who} about ${company.name}`,
      rationale: `${who} replied ${describeWhen(unanswered.at, now)} and there is no answer on the record. A draft is ready for you to check and send.`,
      evidence,
      gap_label: null,
      question: null,
      trace: {
        trigger: `Customer reply ${describeWhen(unanswered.at, now)} with nothing logged since.`,
        data_used: [...dataUsed, "Customer replies on the timeline"],
        knowledge: retrieved.slice(0, 3),
        decision: "An unanswered customer reply outranks internal work.",
        result: null,
      },
      auto_safe: false,
    };
  }

  /* 2. The customer agreed: close it. */
  if (quote?.status === "accepted") {
    return {
      action_type: "internal_task",
      risk: "yellow",
      goal: `Close ${company.name} as Won — quote v${quote.version} accepted`,
      rationale: `${who} accepted quote v${quote.version}. Marking it Won is the last thing sales does here; contracting takes it from there.`,
      evidence,
      gap_label: null,
      question: null,
      trace: { trigger: `Quote v${quote.version} marked accepted.`, data_used: [...dataUsed, "Quotes on the timeline"], knowledge: [], decision: "Accepted quote → close the deal as Won.", result: null },
      auto_safe: false,
      effect: "close_won",
    };
  }

  /* 3. A re-quote is sitting in draft after the customer saw an earlier one. */
  if (quote?.isRequote && (quote.status === "draft" || quote.status === "approved")) {
    return {
      action_type: "internal_task",
      risk: "yellow",
      goal: `Review re-quote v${quote.version} for ${company.name}`,
      rationale: `${who} has already seen an earlier version, so v${quote.version} is a response to their pushback. Check what changed before it goes back out.`,
      evidence,
      gap_label: null,
      question: null,
      trace: {
        trigger: `Quote v${quote.version} drafted after an earlier version was sent.`,
        data_used: [...dataUsed, "Quotes on the timeline"],
        knowledge: [],
        decision: "A re-quote is a negotiation step — it gets read, not auto-sent.",
        result: null,
      },
      auto_safe: false,
    };
  }

  /* 4. A quote out with the customer: chase it, and give up when it is time. */
  if (quote && (quote.status === "sent" || quote.status === "viewed" || quote.status === "negotiating") && quote.sentAt) {
    const daysOut = Math.floor((now.getTime() - new Date(quote.sentAt).getTime()) / 86_400_000);
    if (daysOut >= STALE_QUOTE_DAYS) {
      return {
        action_type: "internal_task",
        risk: "yellow",
        goal: `Close ${company.name} as Lost — no answer in ${daysOut} days`,
        rationale: `Quote v${quote.version} went out ${daysOut} days ago with nothing back, past the ${STALE_QUOTE_DAYS}-day limit. Closing it keeps the pipeline honest; reopen it if they come back.`,
        evidence,
        gap_label: null,
        question: null,
        trace: {
          trigger: `Quote v${quote.version} sent ${daysOut} days ago, no response.`,
          data_used: [...dataUsed, "Quotes on the timeline"],
          knowledge: [],
          decision: `Past the ${STALE_QUOTE_DAYS}-day silence limit → propose closing it as Lost.`,
          result: null,
        },
        auto_safe: false,
        effect: "close_lost",
      };
    }
    if (daysOut >= 3) {
      return {
        action_type: "internal_task",
        risk: "green",
        goal: `Follow up on quote v${quote.version} with ${who}`,
        rationale: `Quote v${quote.version} went out ${daysOut} days ago and there is no answer on the record.`,
        evidence,
        gap_label: null,
        question: null,
        trace: { trigger: `Quote v${quote.version} sent, no response.`, data_used: [...dataUsed, "Quotes on the timeline"], knowledge: [], decision: "A sent quote outranks any qualification detail.", result: null },
        auto_safe: true,
      };
    }
  }

  // Past this point the deal is still being qualified. An opportunity already
  // handed to contracting has nothing else for the agent to drive.
  if (lead.status === "quoted" && !quote) return null;

  /* 1. A booked call that nothing has been prepared for.
   *
   * The window is the whole booking horizon rather than the next two days: a
   * customer can only book about a working week ahead, and the moment to gather
   * the open questions is when the call is booked, not the night before. The
   * preparation is written once per meeting (`hasRecentPreparation` keys on the
   * meeting time), and the loop re-runs on every change to the opportunity, so
   * an early brief is replaced by a current one if the record moves. */
  const meeting = nextMeeting(activities, now);
  if (meeting && hoursUntil(meeting.at, now) <= PREP_HORIZON_HOURS && !hasRecentPreparation(activities, meeting.at)) {
    const open = openQuestions(intelligence);
    return {
      action_type: "prepare_call",
      risk: "green",
      goal: `Prepare for ${meeting.title.toLowerCase()} with ${company.name}`,
      rationale: open.length
        ? `The call is ${describeWhen(meeting.at, now)} and ${open.length === 1 ? "one question is" : `${open.length} questions are`} still unanswered — going in without them wastes the call.`
        : `The call is ${describeWhen(meeting.at, now)}; a short brief of what is known and what to confirm makes it count.`,
      evidence,
      gap_label: null,
      question: null,
      trace: {
        trigger: `Booked call ${describeWhen(meeting.at, now)}.`,
        data_used: [...dataUsed, "Calendar booking on the timeline"],
        knowledge: retrieved.slice(0, 3),
        decision: open.length ? `Unresolved before the call: ${open.slice(0, 3).join("; ")}.` : "Nothing outstanding — a recap brief is enough.",
        result: null,
      },
      auto_safe: true,
    };
  }

  /* 2. The integration the customer expects but has not named — the biggest scope unknown. */
  const integrationGap = intelligence.gaps.missing.find((m) => m.label === "Required integration");
  if (integrationGap) {
    const kind = integrationKind(inquiryText).kind;
    const question = integrationGap.question ?? integrationKind(inquiryText).question;
    return {
      action_type: "ask_customer",
      risk: "green",
      goal: `Confirm which ${kind} ${company.name} uses`,
      rationale: `The requirements call for a ${kind} integration but the system is never named, and it is the only thing blocking a scoped solution.`,
      evidence,
      gap_label: integrationGap.label,
      question,
      trace: {
        trigger: `Customer requires an integration; the ${kind} is unidentified.`,
        data_used: dataUsed,
        knowledge: retrieved.slice(0, 3),
        decision: `${kind} is the blocking gap — every other qualification item needed for contracting is ${intelligence.gaps.missing.length === 1 ? "captured" : "further along"}.`,
        result: null,
      },
      auto_safe: true,
    };
  }

  /* 3. A conflict between what the customer wrote and what was qualified. */
  const conflict = (intelligence.contradictions ?? [])[0];
  if (conflict) {
    return {
      action_type: "ask_customer",
      risk: "yellow",
      goal: `Resolve the ${conflict.topic.toLowerCase()} conflict with ${who}`,
      rationale: `${conflict.a.source === "inquiry" ? "The inquiry" : "Qualification"} says ${conflict.a.value} and ${conflict.b.source === "inquiry" ? "the inquiry" : "qualification"} says ${conflict.b.value}. ${conflict.action}`,
      evidence,
      gap_label: conflict.topic,
      question: `Could you confirm ${conflict.topic.toLowerCase()} for us — we have two different figures on file and want the solution scoped against the right one.`,
      trace: {
        trigger: `Conflicting ${conflict.topic.toLowerCase()} on the record.`,
        data_used: dataUsed,
        knowledge: retrieved.slice(0, 2),
        decision: `${conflict.topic}: ${conflict.a.value} vs ${conflict.b.value}. A person should phrase this one.`,
        result: null,
      },
      auto_safe: false,
    };
  }

  /* 4. The qualification gap that most affects the deal. */
  const order = ["number_of_users", "primary_need", "current_solution", "decision_timeline", "decision_maker", "contact", "budget"] as const;
  const hardGap = order.map((f) => intelligence.gaps.missing.find((m) => m.field === f)).find(Boolean);
  // A requirement-driven follow-up ("users per location", "who needs the
  // reporting") is worth asking, but never ahead of a deal that is otherwise
  // ready: once contracting has everything it needs, chasing detail is the
  // wrong move and the handoff is the right one.
  const softGap = intelligence.readiness?.ready ? undefined : intelligence.gaps.missing.find((m) => m.question);
  const gap = hardGap ?? softGap;
  if (gap) {
    const risk = RISK_BY_FIELD[gap.field ?? ""] ?? "yellow";
    return {
      action_type: "ask_customer",
      risk,
      goal: `Confirm ${gap.label.toLowerCase()} with ${who}`,
      rationale: `${gap.impact}. It is the highest-impact item still missing before this opportunity can be contracted.`,
      evidence,
      gap_label: gap.label,
      question: gap.question ?? `Could you confirm ${gap.label.toLowerCase()} for us?`,
      trace: {
        trigger: `${gap.label} is missing from the record.`,
        data_used: dataUsed,
        knowledge: retrieved.slice(0, 3),
        decision: `${gap.label} chosen over ${intelligence.gaps.missing.length - 1} other open item${intelligence.gaps.missing.length === 2 ? "" : "s"} because ${gap.impact.toLowerCase()}.`,
        result: null,
      },
      auto_safe: risk === "green",
    };
  }

  /* 5. Nothing missing — quote it, or move the quote along. */
  if (intelligence.readiness?.ready) {
    const base = { evidence, gap_label: null, question: null, auto_safe: true, risk: "green" as const, action_type: "internal_task" as const };
    if (!quote) {
      return {
        ...base,
        goal: `Create quote v1 for ${company.name}`,
        rationale: `Every qualification check passes (${intelligence.readiness.checks_passed}/${intelligence.readiness.checks_total}) and the quote context is complete. The next step is a priced proposal.`,
        trace: { trigger: "Readiness reached — no open gaps or conflicts, no quote yet.", data_used: dataUsed, knowledge: retrieved.slice(0, 2), decision: "Qualification complete → quote is the next step. Pricing is a person's call; the agent only points at it.", result: null },
      };
    }
    if (quote.status === "draft") {
      return {
        ...base,
        goal: `Finish and send quote v${quote.version} to ${who}`,
        rationale: `A draft quote exists and qualification is complete. Review the check, get approval if it asks for one, and send.`,
        trace: { trigger: `Quote v${quote.version} is still a draft.`, data_used: [...dataUsed, "Quotes on the timeline"], knowledge: [], decision: "Draft quote on a ready opportunity → send it.", result: null },
      };
    }
    return {
      ...base,
      goal: `Hand ${company.name} to contracting`,
      rationale: `Quote v${quote.version} is ${quote.status} and every qualification check passes. Nothing is left to ask the customer.`,
      trace: { trigger: "Readiness reached with a quote in play.", data_used: [...dataUsed, "Quotes on the timeline"], knowledge: retrieved.slice(0, 2), decision: "No customer contact needed; the next step belongs to a person with contract access.", result: null },
    };
  }

  /* 6. Nothing worth doing yet — say nothing rather than invent busywork. */
  if (mentionsIntegration(inquiryText) || intelligence.gaps.missing.length > 0) return null;
  return null;
}

/* ------------------------------------------------------- message composing */

const COMPOSE_SYSTEM = `You write one short email from an Experience.com salesperson to a prospective customer. The Sales Engine has already decided what to ask; your only job is to phrase it.

Rules — hard constraints:
- Use ONLY the facts in "context". Never state a number, system name, capability, date, price, package, discount or commitment that is not there.
- Do not promise anything: no delivery dates, no guarantees, no "we will build", no service levels.
- Never mention price, pricing, packages, tiers, discounts or fees, even if the customer raised money. A person handles commercial conversations.
- Ask exactly the one question in "question". Do not add a second question.
- Do not describe product capabilities. You may refer to what the customer themselves said they need.
- Plain text, no markdown, no placeholders like [Name] or [Company]. 60-110 words. Warm and direct; a busy broker should be able to answer in one line.
- Open with "Hi <first name>," and sign off with the sender line given in "context.sender". Nothing else after the sign-off.

Return JSON: {"subject": string (≤ 60 characters, specific, no company boilerplate), "body": string (the whole email including greeting and sign-off)}`;

export interface ComposeResult {
  message: AgentDraftMessage;
  /** Why the Claude draft was rejected, when it was. */
  note: string | null;
}

export interface ComposeInput {
  decision: AgentDecision;
  lead: Lead;
  company: Company;
  contact: Contact;
  intelligence: OpportunityIntelligence;
  senderName: string;
  mode?: "auto" | "deterministic";
}

/**
 * Draft the customer message and hold it to the same standard as the brief:
 * anything the record cannot support is thrown away and the deterministic
 * wording is used instead. The result says which one it is, so the UI never
 * labels a template as Claude's work.
 */
export async function composeCustomerMessage(input: ComposeInput): Promise<ComposeResult> {
  const { decision, lead, company, contact, intelligence, senderName } = input;
  const fallback = deterministicMessage(input);
  if (!decision.question) return { message: fallback, note: null };

  const kbText = (intelligence.product_context?.capabilities ?? []).map((c) => `${c.title} ${c.why}`).join(" ");
  const corpus = corpusFrom(
    lead.requirements,
    lead.additional_info,
    lead.interest,
    String(lead.number_of_users ?? ""),
    JSON.stringify(lead.qualification ?? {}),
    company.name,
    company.industry,
    contact.name,
    contact.title,
    senderName,
    decision.question,
    decision.goal,
    intelligence.customer_need,
    kbText
  );
  const allowNames = [contact.name, company.name, senderName, "Experience.com"].flatMap((n) => n.split(/\s+/));

  if (input.mode === "deterministic" || !claudeAvailable()) {
    return { message: fallback, note: null };
  }

  try {
    const res = await callClaudeJson({
      system: COMPOSE_SYSTEM,
      user: JSON.stringify({
        context: {
          customer: company.name,
          industry: company.industry,
          contact_first_name: firstName(contact.name),
          contact_title: contact.title,
          what_the_customer_said: [lead.requirements, lead.additional_info].filter(Boolean).join(" ") || null,
          stated_interest: lead.interest,
          customer_need_summary: intelligence.customer_need,
          sender: senderName,
          company_sending: "Experience.com",
        },
        objective: decision.goal,
        why_we_are_asking: decision.rationale,
        question: decision.question,
      }),
      validate: validateCompose,
      maxTokens: 500,
    });

    const whole = `${res.data.subject}\n${res.data.body}`;
    const problem = groundingProblem(whole, corpus);
    if (problem) return { message: fallback, note: `Claude's draft was replaced by the deterministic wording — ${problem}` };
    const invented = inventedProperNouns(res.data.body, corpus, allowNames);
    if (invented.length) return { message: fallback, note: `Claude's draft was replaced by the deterministic wording — it named ${invented.slice(0, 3).join(", ")}, which appears nowhere on the record.` };
    if (!/^hi\b/i.test(res.data.body.trim())) return { message: fallback, note: "Claude's draft was replaced by the deterministic wording — it did not open as an email to the contact." };

    return {
      message: { to: { name: contact.name, email: contact.email }, subject: res.data.subject, body: res.data.body, generated_by: "claude", model: claudeModel() },
      note: null,
    };
  } catch (err) {
    return { message: fallback, note: `Claude was unavailable; the deterministic wording was used (${err instanceof Error ? err.message : String(err)}).` };
  }
}

function validateCompose(raw: unknown): { subject: string; body: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const subject = typeof o.subject === "string" ? o.subject.trim() : "";
  const body = typeof o.body === "string" ? o.body.trim() : "";
  if (!subject || !body) throw new Error("compose: subject or body missing");
  if (body.length > 1400) throw new Error("compose: body too long");
  if (/\[[^\]]+\]/.test(body)) throw new Error("compose: body contains an unfilled placeholder");
  return { subject, body };
}

/**
 * The wording used when Claude is unavailable or its draft fails the guardrail.
 * Built only from the question the deterministic layer already produced and the
 * customer's own stated need, so it carries no figure and no product claim.
 */
function deterministicMessage(input: ComposeInput): AgentDraftMessage {
  const { decision, company, contact, intelligence, senderName, lead } = input;
  const need = lead.interest?.trim() || intelligence.quote_context.primary_need?.trim() || null;
  const question = decision.question ?? `Could you confirm ${decision.gap_label?.toLowerCase() ?? "a few details"} for us?`;
  const opening = need ? `Thanks for the detail on what you are looking to do around ${lowerFirst(need)}.` : "Thanks for getting in touch about what your team is trying to solve.";
  const body = [
    `Hi ${firstName(contact.name)},`,
    "",
    `${opening} To make sure we scope this correctly for ${company.name}, ${lowerFirst(question)}`,
    "",
    "Once we have that, we can confirm the right approach and the next steps.",
    "",
    "Best,",
    senderName,
  ].join("\n");
  return {
    to: { name: contact.name, email: contact.email },
    subject: decision.gap_label ? `Quick question on ${decision.gap_label.toLowerCase()}` : `Following up on your enquiry`,
    body,
    generated_by: "deterministic",
    model: null,
  };
}

/* ---------------------------------------------------------------- helpers */

/** The active quote as the timeline records it — the agent reads, it never writes quotes. */
interface QuoteRef {
  version: number;
  status: string;
  sentAt: string | null;
  /** True when an earlier version already reached the customer — this one is a re-quote. */
  isRequote: boolean;
  /** The last thing that happened to it, for "nothing since" timing. */
  lastEventAt: string | null;
}

function latestQuote(activities: Activity[]): QuoteRef | null {
  const all = activities.filter((a) => a.metadata?.kind === QUOTE_KIND);
  const live = all.filter((a) => !a.metadata?.superseded);
  const q = (live.length ? live : all).sort((a, b) => Number(b.metadata?.version ?? 0) - Number(a.metadata?.version ?? 0))[0];
  if (!q) return null;
  const history = (q.metadata?.history as { status: string; at: string }[] | undefined) ?? [];
  const version = Number(q.metadata?.version ?? 0);
  // A re-quote is a version above 1 whose predecessor the customer actually
  // saw. A v2 replacing a v1 that never left the building is just an edit.
  const isRequote =
    version > 1 &&
    all.some((a) => {
      const h = (a.metadata?.history as { status: string }[] | undefined) ?? [];
      return Number(a.metadata?.version ?? 0) < version && h.some((e) => e.status === "sent");
    });
  return {
    version,
    status: String(q.metadata?.status ?? "draft"),
    sentAt: history.find((h) => h.status === "sent")?.at ?? null,
    isRequote,
    lastEventAt: history.length ? history[history.length - 1].at : null,
  };
}

export interface MeetingRef {
  at: string;
  title: string;
}

export function nextMeeting(activities: Activity[], now: Date): MeetingRef | null {
  const upcoming = activities
    .filter((a) => a.metadata?.kind === FOLLOW_UP_KIND && !a.metadata?.completed && typeof a.metadata?.scheduled_for === "string")
    .map((a) => ({ at: String(a.metadata.scheduled_for), title: String(a.metadata.title ?? "Discovery call") }))
    .filter((m) => new Date(m.at).getTime() > now.getTime())
    .sort((a, b) => a.at.localeCompare(b.at));
  return upcoming[0] ?? null;
}

/** A preparation note already written for this meeting. */
function hasRecentPreparation(activities: Activity[], meetingAt: string): boolean {
  return activities.some((a) => a.metadata?.kind === "agent_action" && a.metadata?.action_type === "prepare_call" && a.metadata?.state === "executed" && String(a.metadata?.meeting_at ?? "") === meetingAt);
}

export function openQuestions(intelligence: OpportunityIntelligence): string[] {
  return [
    ...intelligence.gaps.missing.map((m) => m.question ?? m.label),
    ...(intelligence.contradictions ?? []).map((c) => `Confirm ${c.topic.toLowerCase()} (${c.a.value} vs ${c.b.value})`),
  ];
}

function hoursUntil(iso: string, now: Date) {
  return (new Date(iso).getTime() - now.getTime()) / 3_600_000;
}

function describeWhen(iso: string, now: Date) {
  const h = hoursUntil(iso, now);
  if (h < 1) return "within the hour";
  if (h < 12) return `in ${Math.round(h)} hours`;
  if (h < 36) return "tomorrow";
  return `on ${new Date(iso).toLocaleDateString("en-US", { weekday: "long" })}`;
}

function firstName(name: string) {
  return name.trim().split(/\s+/)[0];
}

function lowerFirst(s: string) {
  const titleCase = /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(s);
  return /^[A-Z][a-z]/.test(s) && !/^[A-Z]{2}/.test(s) && !titleCase ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
