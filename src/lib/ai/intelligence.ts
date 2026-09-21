import type { Activity, Company, Contact, Lead } from "@/lib/types";
import { computeReadiness } from "@/lib/readiness";
import { DOWNSTREAM } from "@/lib/modules";

/**
 * AI Opportunity Intelligence — the bridge between a customer's raw
 * requirements and Quote Ready (quote → approval → contract).
 *
 * Five sections, each derived ONLY from data on the opportunity (inquiry text,
 * qualification fields, contacts, activity). It interprets, structures and
 * finds gaps; it never invents pricing, packages or customer facts — product
 * and package recommendation stay downstream.
 */
export interface OpportunityIntelligence {
  customer_need: string;
  quote_implications: string[];
  gaps: {
    known: { label: string; value: string }[];
    missing: { label: string; impact: string; field: QualField | null; question?: string }[];
  };
  next_action: { action: string; reason: string; field: QualField | null };
  quote_context: QuoteContext;
  /* --- Added by the grounded workflow (src/lib/ai/orchestrator.ts). Optional so
   *     briefs saved before it existed still render. --- */
  /** Claims about the customer, each tied to the record it came from. */
  evidence?: EvidenceItem[];
  /** What the Sales Knowledge Base says is relevant — cited by document id. */
  product_context?: ProductContext;
  /** Conflicts between what the customer wrote and what was qualified — confirm before Quote Ready. */
  contradictions?: Contradiction[];
  /** Is this opportunity ready to continue to Quote Ready? */
  readiness?: GuidedSellingReadiness;
  /** The one-look chain: customer said → retrieved → identified → gap → readiness → next action. */
  chain?: ChainStep[];
  /** Concise process metadata for the "AI Process" panel — never chain-of-thought. */
  process?: AiProcess;
}

/** "inquiry" | "qualification" | "contact:<name>" | "activity:<n>" | "kb:<doc id>" */
export type SourceRef = string;

export interface EvidenceItem {
  claim: string;
  source: SourceRef;
}

export interface ProductContext {
  capabilities: { kb_id: string; title: string; why: string }[];
  implementation_considerations: { text: string; kb_id: string | null }[];
  quote_context_requirements: { text: string; status: "captured" | "missing" }[];
}

export interface Contradiction {
  topic: string;
  a: { source: SourceRef; value: string };
  b: { source: SourceRef; value: string };
  action: string;
}

export interface ChainStep {
  key: "customer_says" | "retrieved" | "identified" | "gap" | "readiness" | "next_action";
  label: string;
  /** The conclusion of this step, one or two short lines. */
  text: string;
  /** Sources or knowledge documents this step rests on. */
  sources: SourceRef[];
  tone?: "neutral" | "ok" | "warn";
}

export interface GuidedSellingReadiness {
  ready: boolean;
  verdict: string;
  /** The ✓/⚠ checklist: qualification rules plus requirement-driven checks (e.g. integration named). */
  checks: { label: string; ok: boolean; hint: string }[];
  /** Qualification checks still failing (from the deterministic readiness rules). */
  blocking: string[];
  checks_passed: number;
  checks_total: number;
  evaluator: {
    verified_claims: number;
    /** Statements the evaluator removed or flagged, with the reason. */
    flagged: { text: string; reason: string }[];
    contradictions: string[];
  };
}

export type AiMode = "claude" | "deterministic";

export interface StageRun {
  key: "retrieve" | "analyst" | "solution_context" | "evaluator";
  label: string;
  /** How this stage actually ran. */
  mode: AiMode | "skipped";
  duration_ms: number;
  /** One line a judge can read: what the stage concluded. */
  summary: string;
  /** Why it fell back, when it did. */
  note?: string;
}

export interface AiProcess {
  mode: AiMode;
  model: string | null;
  stages: StageRun[];
  tool_calls: { tool: string; input: string; output: string; duration_ms: number }[];
  retrieved: { id: string; title: string; category: string; score: number; matched_terms: string[] }[];
  sources: SourceRef[];
  tokens: { input: number; output: number };
  total_ms: number;
  generated_at: string;
}

export type QualField = "number_of_users" | "current_solution" | "primary_need" | "decision_timeline" | "decision_maker" | "budget" | "contact";

export interface QuoteContext {
  customer: string;
  industry: string | null;
  users: number | null;
  primary_need: string | null;
  deployment: string | null;
  decision_timeline: string | null;
  decision_maker: string | null;
  budget: string | null;
  current_solution: string | null;
  integrations: string[];
  key_requirements: string[];
  primary_contact: { name: string; email: string | null; title: string | null } | null;
  contacts_count: number;
}

export interface IntelligenceInput {
  lead: Lead;
  company: Company;
  contacts: Contact[];
  activities: Activity[];
}

const SCOPE_NOUNS = "clinics?|offices?|locations?|branch(?:es)?|stores?|sites?|regions?|agents?|teams?|departments?|hospitals?|dealerships?|practices?|restaurants?|hotels?|properties";
const INTEGRATION_NAMES = ["HubSpot", "Salesforce", "Zoho", "Pipedrive", "Encompass", "Dynamics", "Google Business", "Google My Business", "Yelp", "Zillow", "MLS", "Calyx", "Byte", "MeridianLink", "Blend", "Total Expert", "Slack", "Zapier", "Epic", "Cerner", "Dentrix", "Open Dental", "Toast", "Square", "Shopify", "Mindbody", "Workday", "BambooHR", "ADP", "SuccessFactors", "UKG", "Rippling", "Gusto", "Paycom", "NetSuite"];

/** Words that tell us the customer expects an integration even when no system is named. */
export const INTEGRATION_MENTION = /\b(integrat\w*|sync\w*|api|crm|connect\w*|hris|hr system|hr platform|payroll system|erp|point[- ]of[- ]sale|pos system|practice[- ]management|ehr|emr|loan[- ]origination(?: system)?|los)\b/i;
export function mentionsIntegration(text: string) {
  return INTEGRATION_MENTION.test(text);
}

/** The kind of system the customer is talking about, so the follow-up question is specific. */
export function integrationKind(text: string): { kind: string; question: string } {
  if (/\b(hris|hr system|hr platform|payroll|employee (?:directory|records)|erp)\b/i.test(text)) return { kind: "HRIS", question: "Which HRIS are you currently using?" };
  if (/\bcrm\b/i.test(text)) return { kind: "CRM", question: "Which CRM are you currently using?" };
  if (/\b(point[- ]of[- ]sale|pos system|pos|checkout|booking system)\b/i.test(text)) return { kind: "point-of-sale", question: "Which point-of-sale or booking system records the transaction?" };
  if (/\b(practice[- ]management|ehr|emr|patient|clinic|dental)\b/i.test(text)) return { kind: "practice-management", question: "Which practice-management or EHR system records completed visits?" };
  if (/\b(loan[- ]origination|los|mortgage|loan officers?|closings?|lender|borrowers?)\b/i.test(text)) return { kind: "loan origination system (LOS)", question: "Which loan origination system are you using — Encompass, or another LOS?" };
  if (/\b(listing|mls|brokerage|agents?)\b/i.test(text)) return { kind: "listing system", question: "Which MLS or listing system should trigger review requests at closing?" };
  return { kind: "system", question: "Which system should trigger surveys or review requests, and which one is it?" };
}

export function buildIntelligence(input: IntelligenceInput): OpportunityIntelligence {
  const { lead, company, contacts } = input;
  const q = lead.qualification ?? {};
  const text = [lead.requirements, lead.additional_info].filter(Boolean).join(" ");
  const users = q.number_of_users ?? lead.number_of_users ?? null;
  const primaryContact = contacts.find((c) => c.id === lead.primary_contact_id) ?? contacts.find((c) => c.is_primary) ?? contacts[0] ?? null;
  const need = q.primary_need ?? lead.interest ?? null;
  const readiness = computeReadiness(lead, contacts);

  // --- Extract structure from the free text --------------------------------
  const deployment = extractDeployment(text);
  const integrations = extractIntegrations(text);
  const wantsIntegration = mentionsIntegration(text);
  const keyRequirements = splitRequirements(text);

  // --- 1. Customer need ------------------------------------------------------
  const needSentence = [
    company.name,
    need ? `wants ${lowerFirst(need)}` : "is evaluating Experience.com",
    deployment ? `across ${deployment}` : null,
    users ? `for ${users} users` : null,
  ]
    .filter(Boolean)
    .join(" ");
  // Only add the customer's own words when they say more than the need already does.
  const first = keyRequirements[0];
  const goal = first && !overlaps(first, need) ? ` — ${trimSentence(first)}` : "";
  const customer_need = `${needSentence}${goal}.`;

  // --- 2. What this means for the quote ---------------------------------------
  const quote_implications: string[] = [];
  if (deployment && users) quote_implications.push(`Multi-location deployment across ${deployment} with ${users} users — the quote should account for both the locations and the user quantity.`);
  else if (deployment) quote_implications.push(`Multi-location deployment across ${deployment} — user count per location still needs confirming before quantities are set.`);
  else if (users) quote_implications.push(`Single deployment for ${users} users — licence quantity can be based directly on this count.`);
  if (need) quote_implications.push(`Primary need is ${lowerFirst(need)} — this is the capability the configuration should be built around.`);
  if (integrations.length) quote_implications.push(`Integration with ${listJoin(integrations)} is expected — confirm scope so it is reflected in the solution.`);
  else if (wantsIntegration) quote_implications.push(`An integration with the customer's ${integrationKind(text).kind} is expected but the system is not named — scope needs confirming before the quote.`);
  if (q.current_solution) quote_implications.push(`Replacing ${q.current_solution} — migration or parallel-run considerations may apply.`);
  if (q.decision_timeline) quote_implications.push(`Decision expected ${lowerFirst(q.decision_timeline)} — quote validity should match.`);
  if (quote_implications.length === 0) quote_implications.push("Requirements are high level so far — the quote can't be scoped until user count and primary need are confirmed.");

  // --- 3. Qualification gaps -------------------------------------------------
  const known: OpportunityIntelligence["gaps"]["known"] = [];
  const missing: OpportunityIntelligence["gaps"]["missing"] = [];
  const push = (ok: boolean, label: string, value: string | null, impact: string, field: QualField | null) =>
    ok && value ? known.push({ label, value }) : missing.push({ label, impact, field });
  push(Boolean(primaryContact?.email), "Primary contact", primaryContact ? `${primaryContact.name}${primaryContact.title ? `, ${primaryContact.title}` : ""}` : null, "No one to send the quote to", "contact");
  push(Boolean(users), "User count", users ? `${users} users` : null, "Licence quantity can't be set", "number_of_users");
  push(Boolean(need), "Primary need", need, "Product configuration can't be chosen", "primary_need");
  push(Boolean(q.decision_timeline), "Decision timeline", q.decision_timeline ?? null, "Quote validity and urgency unknown", "decision_timeline");
  push(Boolean(q.decision_maker), "Decision maker", q.decision_maker ?? null, "Approval path for the quote unknown", "decision_maker");
  push(Boolean(q.budget), "Budget range", q.budget ?? null, "No budget context for the quote", "budget");
  push(Boolean(q.current_solution), "Current solution", q.current_solution ?? null, "Competitive position and migration effort unknown", "current_solution");
  if (wantsIntegration && integrations.length === 0) missing.push({ label: "Required integration", impact: `${integrationKind(text).kind} to integrate with not named`, field: null });

  // --- 4. Exactly one next action -----------------------------------------------
  const next_action = pickNextAction({ lead, primaryContact, missing, readiness, activities: input.activities });

  // --- 5. Quote context (structured deal context) --------------------------
  const quote_context: QuoteContext = {
    customer: company.name,
    industry: company.industry,
    users,
    primary_need: need,
    deployment,
    decision_timeline: q.decision_timeline ?? null,
    decision_maker: q.decision_maker ?? null,
    budget: q.budget ?? null,
    current_solution: q.current_solution ?? null,
    integrations,
    key_requirements: keyRequirements,
    primary_contact: primaryContact ? { name: primaryContact.name, email: primaryContact.email, title: primaryContact.title } : null,
    contacts_count: contacts.length,
  };

  return { customer_need, quote_implications, gaps: { known, missing }, next_action, quote_context };
}

/* ------------------------------------------------------------------ helpers */

function pickNextAction(args: {
  lead: Lead;
  primaryContact: Contact | null;
  missing: OpportunityIntelligence["gaps"]["missing"];
  readiness: ReturnType<typeof computeReadiness>;
  activities: Activity[];
}): OpportunityIntelligence["next_action"] {
  const { lead, primaryContact, missing, readiness, activities } = args;
  const who = primaryContact?.name ?? "the customer";

  if (lead.status === "won") return { action: "Coordinate onboarding with the customer success team", reason: "This opportunity is won; nothing further is needed from sales.", field: null };
  if (lead.status === "lost") return { action: "Record the reason this opportunity was lost", reason: "Keeps the pipeline honest and informs future qualification.", field: null };
  if (lead.status === "quoted") return { action: `Continue in ${DOWNSTREAM.partner}`, reason: "The quote context has been handed off; the quote is built there.", field: null };

  // The gap that most affects the quote, in order of commercial impact.
  const order: QualField[] = ["budget", "decision_maker", "decision_timeline", "number_of_users", "primary_need", "contact"];
  const critical = order.map((f) => missing.find((m) => m.field === f)).find(Boolean);
  const REASON: Record<string, string> = {
    budget: `Budget context frames the quote conversation in ${DOWNSTREAM.partner} — confirming it now avoids rework later.`,
    decision_maker: "The quote needs to reach the person who signs; without them approval stalls.",
    decision_timeline: `Timeline sets quote validity and urgency in ${DOWNSTREAM.partner}.`,
    number_of_users: "Licence quantity is the single biggest driver of the quote.",
    primary_need: "A configuration can't be chosen without knowing the primary capability needed.",
    contact: "There is no verified contact to send the quote to.",
  };
  const hasBeenContacted = activities.some((a) => (a.type === "call" || a.type === "email" || a.type === "message") && a.metadata?.kind !== "follow_up");

  // An integration the customer expects but hasn't named is the biggest scope unknown — ask it first.
  const integration = missing.find((m) => m.label === "Required integration");
  if (integration) {
    const kind = integrationKind([lead.requirements, lead.additional_info].filter(Boolean).join(" ")).kind;
    return { action: `Confirm which ${kind} ${who} uses before ${DOWNSTREAM.partner}`, reason: `The requirements call for a ${kind} integration but don't name the system — it changes the solution scope and the implementation plan.`, field: null };
  }

  if (critical) {
    const ask = critical.field === "contact" ? `Confirm a primary contact and email for ${lead.status === "new" ? "this inquiry" : "the account"}` : `Confirm ${critical.label.toLowerCase()} with ${who}`;
    return {
      action: `${ask}${hasBeenContacted ? " before confirming the deal" : " on the first call"}`,
      reason: REASON[critical.field ?? ""] ?? critical.impact,
      field: critical.field,
    };
  }
  if (readiness.complete && lead.status !== "qualified") {
    return { action: "Mark the opportunity Qualified", reason: "Every field needed to confirm the deal is captured; only the stage is holding it.", field: null };
  }
  return { action: DOWNSTREAM.continueLabel, reason: "Qualification is complete and the deal context is ready to hand to the contract module.", field: null };
}

function extractDeployment(text: string): string | null {
  // "9 dental clinics", "4 clinic locations", "12 agents", "all branch locations" — one optional qualifier word before the scope noun.
  const m = text.match(new RegExp(`\\b(\\d{1,4})\\s+((?:[a-z]+\\s+)?(?:${SCOPE_NOUNS}))\\b`, "i"));
  if (!m) {
    const all = text.match(new RegExp(`\\ball\\s+(?:our\\s+)?((?:[a-z]+\\s+)?(?:${SCOPE_NOUNS}))\\b`, "i"));
    return all ? `all ${all[1].toLowerCase()}` : null;
  }
  return `${m[1]} ${m[2].toLowerCase()}`;
}

function extractIntegrations(text: string): string[] {
  return INTEGRATION_NAMES.filter((n) => new RegExp(`\\b${n.replace(/\s+/g, "\\s+")}\\b`, "i").test(text));
}

function splitRequirements(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+|\n+|;\s*/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3)
    .slice(0, 5);
}

/** True when most of the meaningful words in `need` already appear in `sentence`. */
function overlaps(sentence: string, need: string | null) {
  if (!need) return false;
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const a = words(sentence);
  const b = [...words(need)];
  if (b.length === 0) return false;
  return b.filter((w) => a.has(w)).length / b.length >= 0.5;
}

function trimSentence(s: string) {
  const t = s.replace(/[.!?]+$/, "");
  return t.charAt(0).toLowerCase() + t.slice(1);
}
function lowerFirst(s: string) {
  // Keep Title Case product names ("Experience Management Platform") and acronyms intact.
  const titleCase = /^[A-Z][a-z]+(\s+[A-Z][a-z]+)+$/.test(s);
  return /^[A-Z][a-z]/.test(s) && !/^[A-Z]{2}/.test(s) && !titleCase ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
function listJoin(items: string[]) {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}
