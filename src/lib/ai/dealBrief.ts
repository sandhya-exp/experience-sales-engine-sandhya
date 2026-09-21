import type { Activity, Company, Contact, Lead, Qualification } from "@/lib/types";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";
import { runOpportunityIntelligence, type RunOptions } from "@/lib/ai/orchestrator";
import type { OpportunityDataSource } from "@/lib/ai/tools";

export interface DealBriefContext {
  lead: Lead;
  company: Company;
  contacts: Contact[];
  activities: Activity[];
}

export interface GeneratedBrief {
  summary: string;
  missingInfo: string[];
  nextAction: string;
  nextActionReason: string;
  keyFacts: string[];
  generatedBy: string;
  intelligence: OpportunityIntelligence;
}

const QUALIFICATION_LABELS: Record<keyof Qualification, string> = {
  number_of_users: "confirmed user count",
  current_solution: "current solution",
  primary_need: "primary need",
  decision_timeline: "decision timeline",
  decision_maker: "decision maker",
  budget: "budget",
};

/**
 * The AI Opportunity Intelligence brief for one lead. Not a chatbot: a bounded
 * workflow (src/lib/ai/orchestrator.ts) — tools → deterministic extraction →
 * knowledge retrieval → Analyst → Solution Context → Evaluator — whose
 * deterministic layer is the source of truth and whose Claude stages fall
 * back cleanly when the API is unavailable. Every caller only sees
 * `GeneratedBrief`; the flat columns mirror the structured intelligence for
 * the pipeline table and the Overview.
 */
export async function generateDealBrief(ctx: DealBriefContext, source: OpportunityDataSource = memorySource(ctx), opts: RunOptions = {}): Promise<GeneratedBrief> {
  const { lead, company, contacts, activities } = ctx;
  const run = await runOpportunityIntelligence(lead.id, source, opts);
  const intelligence = run.intelligence;

  const primary = contacts.find((c) => c.id === lead.primary_contact_id) ?? contacts.find((c) => c.is_primary) ?? contacts[0];
  const users = lead.number_of_users ?? lead.qualification?.number_of_users;
  const q = lead.qualification ?? {};

  const missingInfo: string[] = [];
  (Object.keys(QUALIFICATION_LABELS) as (keyof Qualification)[]).forEach((key) => {
    if (key === "number_of_users" && users) return;
    if (!q[key]) missingInfo.push(QUALIFICATION_LABELS[key]);
  });

  // A booked, not-yet-missed follow-up is the one thing that outranks a data gap
  // for an early-stage deal: the rep should walk into that call with the gap
  // list in hand. A missed one is the thing to fix first.
  const isTouch = (a: Activity) => (a.type === "call" || a.type === "email" || a.type === "message") && a.metadata?.kind !== "follow_up";
  const hasBeenContacted = activities.some(isTouch);
  const followUps = activities
    .filter((a) => a.metadata?.kind === "follow_up" && !a.metadata?.completed && typeof a.metadata?.scheduled_for === "string")
    .map((a) => ({ when: new Date(String(a.metadata.scheduled_for)), title: String(a.metadata.title ?? "follow-up") }));
  const upcoming = followUps.filter((f) => f.when.getTime() > Date.now()).sort((a, b) => a.when.getTime() - b.when.getTime())[0];
  const lastContactAt = Math.max(0, ...activities.filter(isTouch).map((a) => new Date(a.occurred_at).getTime()));
  const missed = followUps.filter((f) => f.when.getTime() <= Date.now() && lastContactAt <= f.when.getTime()).sort((a, b) => b.when.getTime() - a.when.getTime())[0];
  const early = lead.status === "new" || lead.status === "contacted";
  const who = primary?.name ?? "the contact";

  let nextAction = intelligence.next_action.action;
  let nextActionReason = intelligence.next_action.reason;
  if (early && upcoming && intelligence.next_action.field) {
    nextAction = `On the ${upcoming.title.toLowerCase()} with ${who} (${fmt(upcoming.when)}), ${lowerFirstWord(intelligence.next_action.action)}`;
  } else if (early && missed) {
    nextAction = `Reschedule the missed ${missed.title.toLowerCase()} with ${who}`;
    nextActionReason = `The ${missed.title.toLowerCase()} booked for ${fmt(missed.when)} has no call or email logged after it.`;
  } else if (early && !hasBeenContacted && !upcoming && !intelligence.next_action.field) {
    nextAction = `Reach out to ${primary?.name ?? "the primary contact"} to introduce the opportunity`;
    nextActionReason = "No outreach has been logged yet.";
  }
  intelligence.next_action = { ...intelligence.next_action, action: nextAction, reason: nextActionReason };
  const step = intelligence.chain?.find((c) => c.key === "next_action");
  if (step) step.text = nextAction;

  const keyFacts: string[] = [];
  if (users) keyFacts.push(`${users} users`);
  if (company.industry) keyFacts.push(company.industry);
  if (lead.interest) keyFacts.push(lead.interest);
  if (primary) keyFacts.push(`${primary.name}${primary.title ? ` — ${primary.title}` : ""} is the primary contact`);
  if (q.decision_maker) keyFacts.push(`Decision maker: ${q.decision_maker}`);
  if (q.current_solution) keyFacts.push(`Currently using: ${q.current_solution}`);

  return {
    summary: intelligence.customer_need,
    missingInfo,
    nextAction,
    nextActionReason,
    keyFacts,
    generatedBy: run.generatedBy,
    intelligence,
  };
}

/** Tool data source over an already-loaded context (evals, seeds). The app uses the database source in service.ts. */
export function memorySource(ctx: DealBriefContext): OpportunityDataSource {
  return {
    async getOpportunity(leadId) {
      return leadId === ctx.lead.id ? { lead: ctx.lead, company: ctx.company } : null;
    },
    async getContacts() {
      return ctx.contacts;
    },
    async getActivities() {
      return ctx.activities;
    },
  };
}

function fmt(d: Date) {
  return d.toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
function lowerFirstWord(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1);
}
