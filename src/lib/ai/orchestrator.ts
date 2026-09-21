import type { Activity, Contact, Lead } from "@/lib/types";
import { computeReadiness } from "@/lib/readiness";
import { DOWNSTREAM } from "@/lib/modules";
import { buildIntelligence, integrationKind, mentionsIntegration, type AiProcess, type ChainStep, type Contradiction, type EvidenceItem, type GuidedSellingReadiness, type OpportunityIntelligence, type ProductContext, type StageRun } from "@/lib/ai/intelligence";
import { callClaudeJson, claudeAvailable, claudeModel } from "@/lib/ai/claude";
import { makeTools, ToolTrace, type OpportunityDataSource, type QualificationView } from "@/lib/ai/tools";
import { getKnowledgeDoc } from "@/lib/ai/knowledge/index";
import type { RetrievedDoc } from "@/lib/ai/knowledge/retrieval";

/**
 * AI Opportunity Intelligence — the grounded workflow.
 *
 *   tools ─► deterministic extraction (source of truth) ─► retrieval
 *         ─► 1. Opportunity Analyst  (Claude, grounded in the record)
 *         ─► 2. Solution Context     (Claude, grounded in retrieved knowledge)
 *         ─► 3. Readiness / Evaluator (deterministic checks + Claude review)
 *         ─► one OpportunityIntelligence, saved by the caller
 *
 * Three specialised stages, one pass each, no loops, no autonomy: every stage
 * is a bounded function of the opportunity record and the knowledge base. The
 * deterministic layer (`buildIntelligence`, `computeReadiness`) decides the
 * facts — gaps, quote context, readiness — and Claude is only allowed to
 * interpret and explain those facts with citations. The evaluator strips
 * anything it cannot trace back to a source. If Claude is unavailable or any
 * stage fails, that stage's deterministic result is used and the brief says so.
 *
 * Nothing here writes. Status changes, qualification edits and the Guided
 * Selling handoff stay behind the actions a person clicks.
 */
export interface RunOptions {
  /** Force deterministic mode (evals, demos without a key). */
  mode?: "auto" | "deterministic";
  now?: Date;
}

export interface IntelligenceRun {
  intelligence: OpportunityIntelligence;
  generatedBy: string;
}

export async function runOpportunityIntelligence(leadId: string, source: OpportunityDataSource, opts: RunOptions = {}): Promise<IntelligenceRun> {
  const started = Date.now();
  const trace = new ToolTrace();
  const tools = makeTools(source, trace);
  const useClaude = opts.mode !== "deterministic" && claudeAvailable();
  const stages: StageRun[] = [];
  const tokens = { input: 0, output: 0 };

  // ---- Tools: read the record ------------------------------------------------
  const record = await tools.getOpportunity(leadId);
  if (!record) throw new Error("Opportunity not found");
  const { lead, company } = record;
  const contacts = await tools.getContacts(company.id);
  const activities = await tools.getActivities(leadId);
  const qualification = await tools.getQualification(lead);

  // ---- Deterministic source of truth -----------------------------------------
  const base = buildIntelligence({ lead, company, contacts, activities });
  const readiness = computeReadiness(lead, contacts);
  const facts = buildFactSheet({ lead, company, contacts, activities, qualification, base });
  const recordContradictions = detectContradictions(lead, contacts);

  // ---- Retrieval -------------------------------------------------------------
  const tRetrieve = Date.now();
  const capabilityQuery = [lead.interest, base.quote_context.primary_need, company.industry, ...base.quote_context.integrations, lead.requirements, lead.additional_info]
    .filter(Boolean)
    .join(" ");
  const guidanceQuery = [
    ...base.gaps.missing.map((m) => m.label),
    base.quote_context.deployment ? "multi-location locations rollout" : "",
    base.quote_context.integrations.length ? "integration trigger" : "",
    (base.quote_context.users ?? 0) >= 1000 ? "enterprise thousands employees rollout phased security review procurement stakeholders" : "",
    lead.additional_info ?? "",
    // Matches the quote_prep documents by their own wording, so the query term
    // tracks the stage name rather than drifting from it.
    `${DOWNSTREAM.name.toLowerCase()} handoff quote context`,
  ].join(" ");
  const retrievedCapabilities = await tools.searchKnowledge(capabilityQuery, { categories: ["capability", "integration"], limit: 4 });
  const retrievedGuidance = await tools.searchKnowledge(guidanceQuery, { categories: ["qualification", "quote_prep"], limit: 3 });
  const retrieved = dedupe([...retrievedCapabilities, ...retrievedGuidance]);
  stages.push({
    key: "retrieve",
    label: "Retrieve sales knowledge",
    mode: "deterministic",
    duration_ms: Date.now() - tRetrieve,
    summary: retrieved.length ? `${retrieved.length} documents retrieved: ${retrieved.map((r) => r.doc.title).join(" · ")}` : "No knowledge-base documents matched this opportunity.",
  });

  // ---- Stage 1: Opportunity Analyst ------------------------------------------
  let analyst = deterministicAnalyst({ lead, company, contacts, activities, base, facts });
  let analystStage: StageRun = { key: "analyst", label: "Opportunity Analyst", mode: "deterministic", duration_ms: 0, summary: "" };
  if (useClaude) {
    const t = Date.now();
    try {
      const res = await callClaudeJson({
        system: ANALYST_SYSTEM,
        user: JSON.stringify({ opportunity: facts.record, allowed_sources: facts.sourceIds, deterministic_draft: { customer_need: base.customer_need, observations: base.quote_implications, missing: base.gaps.missing.map((m) => m.label) } }),
        validate: validateAnalyst,
        maxTokens: 900,
      });
      tokens.input += res.input_tokens;
      tokens.output += res.output_tokens;
      // Rule-based follow-ups are always kept; Claude adds the ones only a reading of the text reveals.
      const ruleBased = deterministicFollowUps(lead, base);
      const extra = res.data.follow_up_questions.filter((f) => !ruleBased.some((r) => sameGap(r.gap, f.gap)));
      analyst = { ...res.data, follow_up_questions: [...ruleBased, ...extra].slice(0, 4) };
      analystStage = { ...analystStage, mode: "claude", duration_ms: Date.now() - t };
    } catch (err) {
      analystStage = { ...analystStage, duration_ms: Date.now() - t, note: `Fell back to deterministic analysis: ${describe(err)}` };
    }
  } else {
    analystStage.note = opts.mode === "deterministic" ? "Deterministic mode requested." : "Claude not configured (ANTHROPIC_API_KEY unset).";
  }

  // ---- Stage 2: Solution Context ---------------------------------------------
  let solution = deterministicSolutionContext({ retrieved, qualification, base });
  let solutionStage: StageRun = { key: "solution_context", label: "Solution Context", mode: "deterministic", duration_ms: 0, summary: "" };
  if (useClaude && analystStage.mode === "claude") {
    const t = Date.now();
    try {
      const res = await callClaudeJson({
        system: SOLUTION_SYSTEM,
        user: JSON.stringify({
          customer_need: analyst.customer_need,
          facts: facts.record,
          captured_qualification: qualification.captured,
          missing_qualification: qualification.missing,
          knowledge: retrieved.map((r) => ({ id: r.doc.id, title: r.doc.title, category: r.doc.category, content: r.doc.content })),
        }),
        validate: validateSolution,
        maxTokens: 1100,
      });
      tokens.input += res.input_tokens;
      tokens.output += res.output_tokens;
      solution = res.data;
      solutionStage = { ...solutionStage, mode: "claude", duration_ms: Date.now() - t };
    } catch (err) {
      solutionStage = { ...solutionStage, duration_ms: Date.now() - t, note: `Fell back to retrieved-document summary: ${describe(err)}` };
    }
  } else if (useClaude) {
    solutionStage.note = "Skipped Claude because the Analyst stage fell back.";
  }

  // ---- Stage 3: Readiness / Evaluator ----------------------------------------
  const tEval = Date.now();
  const evaluation = deterministicEvaluate({ analyst, solution, facts, retrieved, qualification, base });
  let evaluatorStage: StageRun = { key: "evaluator", label: "Readiness / Evaluator", mode: "deterministic", duration_ms: 0, summary: "" };
  let contradictions: string[] = [];
  let verdict: string | null = null;
  if (useClaude && analystStage.mode === "claude") {
    try {
      const res = await callClaudeJson({
        system: EVALUATOR_SYSTEM,
        user: JSON.stringify({
          facts: facts.record,
          retrieved_ids: retrieved.map((r) => r.doc.id),
          result: { customer_need: evaluation.analyst.customer_need, observations: evaluation.analyst.observations, evidence: evaluation.analyst.evidence, product_context: evaluation.solution },
          qualification_checks: readiness.checks.map((c) => ({ label: c.label, ok: c.ok })),
          known_conflicts: recordContradictions.map((c) => `${c.topic}: ${c.a.source} says ${c.a.value}, ${c.b.source} says ${c.b.value}`),
        }),
        validate: validateEvaluator,
        maxTokens: 700,
      });
      tokens.input += res.input_tokens;
      tokens.output += res.output_tokens;
      contradictions = res.data.contradictions;
      verdict = res.data.verdict;
      // Anything Claude flags as unsupported is removed as well — belt and braces.
      for (const u of res.data.unsupported_claims) evaluation.remove(u.text, `Evaluator: ${u.reason}`);
      evaluatorStage = { ...evaluatorStage, mode: "claude" };
    } catch (err) {
      evaluatorStage.note = `Claude review unavailable; deterministic checks applied: ${describe(err)}`;
    }
  }
  evaluatorStage.duration_ms = Date.now() - tEval;

  // Requirement-driven checks join the six qualification rules.
  const inquiryText = [lead.requirements, lead.additional_info].filter(Boolean).join(" ");
  const wantsIntegration = mentionsIntegration(inquiryText);
  const checks = [
    { label: "Customer requirement identified", ok: Boolean(lead.requirements || lead.qualification?.primary_need), hint: "What the customer is trying to achieve" },
    ...readiness.checks.map((c) => ({ label: c.label, ok: c.ok, hint: c.hint })),
    ...(wantsIntegration || base.quote_context.integrations.length ? [{ label: "Integration requirement identified", ok: base.quote_context.integrations.length > 0, hint: "Which system triggers outreach" }] : []),
    { label: "No conflicts between inquiry and qualification", ok: recordContradictions.length === 0 && contradictions.length === 0, hint: "Same user count, need and decision maker everywhere" },
  ];
  const blocking = checks.filter((c) => !c.ok).map((c) => c.label);
  // Ready only when every check passes — including the requirement-driven ones the six qualification rules don't cover.
  const ready = checks.every((c) => c.ok);
  const allContradictions = [...recordContradictions.map((c) => `${c.topic}: ${c.a.source} says ${c.a.value}, ${c.b.source} says ${c.b.value}.`), ...contradictions];
  const readinessResult: GuidedSellingReadiness = {
    ready,
    verdict:
      verdict ??
      (ready
        ? `Qualification is complete and every statement in this brief traces to the record — ready to ${DOWNSTREAM.continueLabel.toLowerCase()}.`
        : allContradictions.length
          ? `Not yet: ${allContradictions.length === 1 ? "a conflict" : `${allContradictions.length} conflicts`} between the inquiry and qualification must be confirmed first (${recordContradictions.map((c) => c.topic.toLowerCase()).join(", ") || "see AI check"}).`
          : `Not yet: ${blocking.length} ${blocking.length === 1 ? "item is" : "items are"} still missing (${blocking.join(", ")}).`),
    checks,
    blocking,
    checks_passed: checks.filter((c) => c.ok).length,
    checks_total: checks.length,
    evaluator: { verified_claims: evaluation.analyst.evidence.length, flagged: evaluation.flagged, contradictions: allContradictions },
  };

  // ---- Stage summaries (concise conclusions, not reasoning) ------------------
  analystStage.summary = `${evaluation.analyst.evidence.length} evidence-backed statements from the inquiry, qualification, ${contacts.length} contact${contacts.length === 1 ? "" : "s"} and ${activities.length} activit${activities.length === 1 ? "y" : "ies"}.`;
  solutionStage.summary = evaluation.solution.capabilities.length
    ? `Relevant: ${evaluation.solution.capabilities.map((c) => c.title).join(", ")} · ${evaluation.solution.implementation_considerations.length} implementation consideration${evaluation.solution.implementation_considerations.length === 1 ? "" : "s"}.`
    : "No capability documents matched — the inquiry needs more detail.";
  evaluatorStage.summary = `${evaluation.analyst.evidence.length} claims verified against sources · ${evaluation.flagged.length} removed · ${allContradictions.length} conflict${allContradictions.length === 1 ? "" : "s"} · ${checks.filter((c) => c.ok).length}/${checks.length} readiness checks · ${ready ? "ready" : "not ready"} for ${DOWNSTREAM.partner}.`;
  stages.push(analystStage, solutionStage, evaluatorStage);

  const mode: AiProcess["mode"] = analystStage.mode === "claude" ? "claude" : "deterministic";
  const process: AiProcess = {
    mode,
    model: mode === "claude" ? claudeModel() : null,
    stages,
    tool_calls: trace.calls,
    retrieved: retrieved.map((r) => ({ id: r.doc.id, title: r.doc.title, category: r.doc.category, score: r.score, matched_terms: r.matched_terms })),
    sources: facts.sourceIds,
    tokens,
    total_ms: Date.now() - started,
    generated_at: (opts.now ?? new Date()).toISOString(),
  };

  const missingWithQuestions: OpportunityIntelligence["gaps"]["missing"] = [
    ...base.gaps.missing.map((m) => ({ ...m, question: m.field ? QUESTION_FOR[m.field] : m.label === "Required integration" ? integrationKind(inquiryText).question : undefined })),
    ...evaluation.analyst.follow_up_questions
      .filter((f) => !(/integration/i.test(f.gap) && base.gaps.missing.some((m) => m.label === "Required integration")))
      .filter((f) => !base.gaps.missing.some((m) => m.label.toLowerCase().includes(f.gap.toLowerCase().split(" ")[0])))
      .map((f) => ({ label: f.gap, impact: "Revealed by the customer's own requirements — needed to scope the solution", field: null, question: f.question })),
  ];
  // ---- The one-look chain -----------------------------------------------------
  const quote = lead.requirements?.trim() ? `“${truncate(lead.requirements.trim(), 140)}”` : lead.interest ? `Interested in ${lead.interest}.` : "No requirements text on the inquiry.";
  const capDocs = evaluation.solution.capabilities;
  const shortTitle = (t: string) => t.replace(/\s*\(.*?\)\s*/g, "").trim();
  const identified = [
    capDocs.length ? `${capDocs.map((c) => shortTitle(c.title)).join(" and ")} ${capDocs.length === 1 ? "is" : "are"} relevant` : null,
    base.quote_context.integrations.length ? `${base.quote_context.integrations.join(", ")} integration named` : wantsIntegration ? `${integrationKind(inquiryText).kind} integration required` : null,
    base.quote_context.users ? `user count stated (${base.quote_context.users})` : null,
    base.quote_context.deployment ? `deployment across ${base.quote_context.deployment}` : null,
  ].filter((x): x is string => Boolean(x));
  const topGap = missingWithQuestions.find((m) => m.label === "Required integration") ?? missingWithQuestions.find((m) => !m.field) ?? missingWithQuestions[0];
  const chain: ChainStep[] = [
    { key: "customer_says", label: "Customer says", text: quote, sources: ["inquiry"] },
    {
      key: "retrieved",
      label: "Knowledge retrieved",
      text: retrieved.length ? retrieved.slice(0, 4).map((r) => shortTitle(r.doc.title)).join(" · ") : "No matching documents",
      sources: retrieved.slice(0, 4).map((r) => `kb:${r.doc.id}`),
    },
    { key: "identified", label: "AI identifies", text: identified.length ? sentenceList(identified) : "Not enough detail to identify a capability yet.", sources: [...capDocs.map((c) => `kb:${c.kb_id}`), "inquiry"] },
    topGap
      ? { key: "gap", label: "Gap", text: `${topGap.label}${topGap.question ? ` — ask: “${topGap.question}”` : ""}`, sources: ["qualification", "inquiry"], tone: "warn" as const }
      : { key: "gap", label: "Gap", text: recordContradictions.length ? `Conflict: ${recordContradictions[0].topic} (${recordContradictions[0].a.value} vs ${recordContradictions[0].b.value})` : "None — every qualification item is captured.", sources: ["qualification"], tone: recordContradictions.length ? ("warn" as const) : ("ok" as const) },
    { key: "readiness", label: DOWNSTREAM.readinessLabel, text: ready ? "Ready" : `Not ready — still needed: ${blocking.slice(0, 3).join(", ")}${blocking.length > 3 ? ` +${blocking.length - 3}` : ""}`, sources: [], tone: ready ? ("ok" as const) : ("warn" as const) },
    { key: "next_action", label: "Next action", text: base.next_action.action, sources: [], tone: "neutral" as const },
  ];

  const intelligence: OpportunityIntelligence = {
    ...base,
    chain,
    gaps: { known: base.gaps.known, missing: missingWithQuestions },
    contradictions: recordContradictions,
    customer_need: evaluation.analyst.customer_need,
    quote_implications: evaluation.analyst.observations.length ? evaluation.analyst.observations : base.quote_implications,
    evidence: evaluation.analyst.evidence,
    product_context: evaluation.solution,
    readiness: readinessResult,
    process,
  };
  return { intelligence, generatedBy: mode === "claude" ? `claude:${claudeModel()}` : "deterministic" };
}

/* ============================================================== fact sheet */

interface FactSheet {
  /** What the model sees — the record, nothing else. */
  record: Record<string, unknown>;
  sourceIds: string[];
  /** Lower-cased bag of every token that appears in the record; used to catch invented figures/names. */
  tokens: Set<string>;
  numbers: Set<string>;
}

function buildFactSheet(args: { lead: Lead; company: { name: string; industry: string | null }; contacts: Contact[]; activities: Activity[]; qualification: QualificationView; base: OpportunityIntelligence }): FactSheet {
  const { lead, company, contacts, activities, qualification, base } = args;
  const recentActivities = activities.slice(0, 12).map((a, i) => ({
    id: `activity:${i + 1}`,
    type: a.type,
    when: a.occurred_at,
    by: a.actor_name,
    body: a.body,
    ...(a.metadata?.kind ? { kind: a.metadata.kind, title: a.metadata.title, scheduled_for: a.metadata.scheduled_for } : {}),
  }));
  const record = {
    company: { name: company.name, industry: company.industry },
    inquiry: { id: "inquiry", interest: lead.interest, number_of_users: lead.number_of_users, requirements: lead.requirements, additional_info: lead.additional_info, submitted_at: lead.created_at, status: lead.status },
    qualification: { id: "qualification", status: qualification.status, captured: qualification.captured, missing: qualification.missing },
    contacts: contacts.map((c) => ({ id: `contact:${c.name}`, name: c.name, title: c.title, has_email: Boolean(c.email), is_primary: c.is_primary || c.id === lead.primary_contact_id })),
    activities: recentActivities,
    extracted: { deployment: base.quote_context.deployment, integrations: base.quote_context.integrations, key_requirements: base.quote_context.key_requirements },
  };
  const sourceIds = ["inquiry", "qualification", ...contacts.map((c) => `contact:${c.name}`), ...recentActivities.map((a) => a.id)];
  const text = JSON.stringify(record).toLowerCase();
  const tokens = new Set(text.match(/[a-z][a-z0-9'&+-]*/g) ?? []);
  const numbers = new Set((text.match(/\d[\d,.]*/g) ?? []).map(normalizeNumber));
  return { record, sourceIds, tokens, numbers };
}

function normalizeNumber(n: string) {
  return n.replace(/[,.]$/, "").replace(/,/g, "");
}

/* ========================================================= stage 1: analyst */

interface AnalystResult {
  customer_need: string;
  observations: string[];
  evidence: EvidenceItem[];
  /** Requirement-driven gaps the record itself reveals (e.g. "integration mentioned, system not named"), with the question to ask. */
  follow_up_questions: { gap: string; question: string; source: string }[];
}

const ANALYST_SYSTEM = `You are the Opportunity Analyst in Experience.com's Sales Engine. You read ONE opportunity record (inquiry, qualification, contacts, activity) and explain it to a salesperson preparing for ${DOWNSTREAM.name}.

Rules — these are hard constraints:
- Use only facts present in the record. Never invent customer facts, numbers, names, systems, dates, pricing, packages, discounts or product capabilities.
- Every evidence claim must cite exactly one source id from "allowed_sources" ("inquiry", "qualification", "contact:<name>", "activity:<n>").
- The deterministic_draft lists what the system already extracted; refine and explain it, do not contradict it. If the record is thin, say less.
- Write for a busy salesperson: concrete, specific, no filler.

Return JSON: {"customer_need": string (one sentence, ≤ 40 words, states who the customer is, what they want and at what scale),
"observations": string[] (2–4 short sentences on what this means for the deal — scope, urgency, stakeholders, risks — grounded in the record),
"evidence": [{"claim": string, "source": string}] (4–8 items; the specific facts the brief rests on),
"follow_up_questions": [{"gap": string (what is unclear, ≤ 8 words), "question": string (the exact question to ask the customer), "source": string (the source id that reveals the gap)}] (0–3 items; ONLY gaps the customer's own words reveal — e.g. an integration mentioned without naming the system, a rollout without a location count, a requirement that needs clarifying. Do NOT list the standard qualification fields here; the system tracks those.)}`;

function validateAnalyst(raw: unknown): AnalystResult {
  const o = obj(raw);
  const customer_need = str(o.customer_need);
  if (!customer_need) throw new Error("analyst: customer_need missing");
  const observations = strArr(o.observations).slice(0, 4);
  const evidence = arr(o.evidence)
    .map((e) => ({ claim: str(obj(e).claim), source: str(obj(e).source) }))
    .filter((e) => e.claim && e.source)
    .slice(0, 8);
  const follow_up_questions = arr(o.follow_up_questions)
    .map((q) => ({ gap: str(obj(q).gap), question: str(obj(q).question), source: str(obj(q).source) }))
    .filter((q) => q.gap && q.question)
    .slice(0, 3);
  return { customer_need, observations, evidence, follow_up_questions };
}

function deterministicAnalyst(args: { lead: Lead; company: { name: string }; contacts: Contact[]; activities: Activity[]; base: OpportunityIntelligence; facts: FactSheet }): AnalystResult {
  const { lead, contacts, activities, base } = args;
  const q = lead.qualification ?? {};
  const evidence: EvidenceItem[] = [];
  const primary = contacts.find((c) => c.id === lead.primary_contact_id) ?? contacts.find((c) => c.is_primary) ?? contacts[0];
  if (lead.interest) evidence.push({ claim: `Interested in ${lead.interest}.`, source: "inquiry" });
  if (base.quote_context.users) evidence.push({ claim: `${base.quote_context.users} users stated.`, source: q.number_of_users ? "qualification" : "inquiry" });
  if (base.quote_context.deployment) evidence.push({ claim: `Deployment across ${base.quote_context.deployment}.`, source: "inquiry" });
  if (base.quote_context.integrations.length) evidence.push({ claim: `Mentions ${base.quote_context.integrations.join(", ")}.`, source: "inquiry" });
  if (q.current_solution) evidence.push({ claim: `Currently using ${q.current_solution}.`, source: "qualification" });
  if (q.decision_timeline) evidence.push({ claim: `Decision expected ${q.decision_timeline}.`, source: "qualification" });
  if (q.decision_maker) evidence.push({ claim: `Decision maker: ${q.decision_maker}.`, source: "qualification" });
  if (q.budget) evidence.push({ claim: `Budget context stated: ${q.budget}.`, source: "qualification" });
  if (primary) evidence.push({ claim: `${primary.name}${primary.title ? ` (${primary.title})` : ""} is the primary contact${primary.email ? " with a verified email" : ""}.`, source: `contact:${primary.name}` });
  const lastTouch = activities.find((a) => a.type === "call" || a.type === "email" || a.type === "message");
  if (lastTouch) {
    const idx = activities.indexOf(lastTouch);
    if (idx < 12) evidence.push({ claim: `Last ${lastTouch.type} logged by ${lastTouch.actor_name ?? "the team"}${lastTouch.body ? `: “${truncate(lastTouch.body, 90)}”` : ""}.`, source: `activity:${idx + 1}` });
  }
  return { customer_need: base.customer_need, observations: base.quote_implications, evidence: evidence.slice(0, 8), follow_up_questions: deterministicFollowUps(lead, base) };
}

/** Requirement-driven gaps the record reveals on its own, each with the question that closes it. */
function deterministicFollowUps(lead: Lead, base: OpportunityIntelligence): AnalystResult["follow_up_questions"] {
  const text = [lead.requirements, lead.additional_info].filter(Boolean).join(" ");
  const out: AnalystResult["follow_up_questions"] = [];
  if (mentionsIntegration(text) && base.quote_context.integrations.length === 0) {
    const k = integrationKind(text);
    out.push({ gap: `${k.kind} integration not specified`, question: k.question, source: "inquiry" });
  }
  if (base.quote_context.deployment && base.quote_context.users) out.push({ gap: "Users per location unclear", question: `Is the ${base.quote_context.users}-user figure across all ${base.quote_context.deployment}, and will every location go live at once or in phases?`, source: "inquiry" });
  else if (base.quote_context.deployment) out.push({ gap: "User count per location", question: `How many people at each of the ${base.quote_context.deployment} will use the platform?`, source: "inquiry" });
  if (/\b(dashboard|report(?:ing)?)\b/i.test(text)) out.push({ gap: "Reporting needs unspecified", question: "Who needs to see the reporting — per location, per team, or a single group view — and how often?", source: "inquiry" });
  // "Something else", or nothing at all now that the interest field is optional:
  // either way the inquiry has not said which capability it wants, and that is
  // the question to open the call with.
  if (lead.interest === "Something else" || !lead.interest?.trim())
    out.push({ gap: "Requested capability unclear", question: "What outcome are you hoping to achieve, and what does success look like in six months?", source: "inquiry" });
  return out.slice(0, 3);
}

/* ================================================ contradictions */

const QUESTION_FOR: Record<string, string> = {
  budget: "Is there an approved budget or a range you are working within?",
  decision_maker: "Who approves the purchase and signs the agreement?",
  decision_timeline: "When do you need this live, and what is driving that date?",
  number_of_users: "How many people will use the platform, and does that include every location?",
  primary_need: "Which capability matters most to you first?",
  contact: "Who should receive the quote, and what is the best email for them?",
  integration_unnamed: "Which system should trigger surveys or review requests, and which one is it?",
  current_solution: "What are you using today for this, and what prompted the change?",
};

/**
 * Deterministic contradiction checks between what the customer wrote and what
 * was qualified. Each one names both sources and the confirming action.
 */
function detectContradictions(lead: Lead, contacts: Contact[]): Contradiction[] {
  const q = lead.qualification ?? {};
  const out: Contradiction[] = [];
  const text = [lead.requirements, lead.additional_info].filter(Boolean).join(" ");
  if (lead.number_of_users && q.number_of_users && lead.number_of_users !== q.number_of_users) {
    out.push({
      topic: "User count",
      a: { source: "inquiry", value: `${lead.number_of_users} users` },
      b: { source: "qualification", value: `${q.number_of_users} users` },
      action: "Confirm the expected user count with the customer before Quote Ready — licence quantity depends on it.",
    });
  }
  if (lead.interest && q.primary_need && lead.interest !== "Something else" && !overlapsLoose(lead.interest, q.primary_need)) {
    out.push({
      topic: "Primary need",
      a: { source: "inquiry", value: lead.interest },
      b: { source: "qualification", value: q.primary_need },
      action: "Confirm which capability is the priority so the right configuration is prepared.",
    });
  }
  const signer = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})\s+(?:signs? off|approves?|is the decision maker|makes the decision)/)?.[1] ?? text.match(/(?:decision maker|signer)\s+(?:is|will be)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/)?.[1];
  if (signer && q.decision_maker && !q.decision_maker.toLowerCase().includes(signer.toLowerCase().split(" ").pop() ?? "")) {
    out.push({
      topic: "Decision maker",
      a: { source: "inquiry", value: signer },
      b: { source: "qualification", value: q.decision_maker },
      action: "Confirm who actually approves and signs — the contract in Quote Ready goes to this person.",
    });
  }
  const primary = contacts.find((c) => c.id === lead.primary_contact_id) ?? contacts.find((c) => c.is_primary);
  if (primary && q.decision_maker && contacts.length > 1 && !contacts.some((c) => q.decision_maker!.toLowerCase().includes(c.name.toLowerCase().split(" ").pop() ?? "\u0000"))) {
    out.push({
      topic: "Decision maker not on the contact list",
      a: { source: "qualification", value: q.decision_maker },
      b: { source: `contact:${primary.name}`, value: `${contacts.length} contacts, none matching` },
      action: "Add the decision maker as a contact so the quote and contract reach them.",
    });
  }
  return out;
}

function sameGap(a: string, b: string) {
  const w = (t: string) => new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const wa = w(a);
  const wb = [...w(b)];
  return wb.filter((x) => wa.has(x)).length >= Math.min(2, wb.length);
}

function overlapsLoose(a: string, b: string) {
  const words = (t: string) => new Set(t.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const wa = words(a);
  const wb = [...words(b)];
  return wb.length === 0 || wb.some((w) => wa.has(w)) || a.toLowerCase().includes(b.toLowerCase()) || b.toLowerCase().includes(a.toLowerCase());
}

/* ================================================ stage 2: solution context */

const SOLUTION_SYSTEM = `You are the Solution Context agent in Experience.com's Sales Engine. Given one customer's need and the sales knowledge documents retrieved for it, identify what is relevant so ${DOWNSTREAM.name} receives good context.

Rules — hard constraints:
- Use ONLY the provided knowledge documents for product and integration statements, and cite the document id on every item. Do not add capabilities, connectors or facts that are not in those documents.
- Never mention pricing, packages, tiers, discounts or quote amounts — those are decided in ${DOWNSTREAM.name}.
- Do not restate customer facts you were not given.
- Be specific to this customer: say why each capability is relevant to their stated need.

Return JSON: {"capabilities": [{"kb_id": string, "why": string (one sentence tying it to the customer's need)}] (1–3 items, only category "capability" or "integration" documents),
"implementation_considerations": [{"text": string, "kb_id": string}] (2–4 short items: things to confirm or plan — triggers, locations, data, stakeholders),
"quote_context_requirements": [{"text": string, "status": "captured" | "missing"}] (3–6 items: what ${DOWNSTREAM.name} needs from this deal; use captured_qualification / missing_qualification to set status)}`;

function validateSolution(raw: unknown): ProductContext {
  const o = obj(raw);
  const capabilities = arr(o.capabilities)
    .map((c) => {
      // Unknown ids are kept here so the evaluator can flag them visibly rather than silently dropping them.
      const kb_id = str(obj(c).kb_id);
      return kb_id ? { kb_id, title: getKnowledgeDoc(kb_id)?.title ?? kb_id, why: str(obj(c).why) } : null;
    })
    .filter((c): c is ProductContext["capabilities"][number] => Boolean(c && c.why))
    .slice(0, 3);
  const implementation_considerations = arr(o.implementation_considerations)
    .map((c) => ({ text: str(obj(c).text), kb_id: str(obj(c).kb_id) || null }))
    .filter((c) => c.text)
    .slice(0, 4);
  const quote_context_requirements = arr(o.quote_context_requirements)
    .map((c) => ({ text: str(obj(c).text), status: (str(obj(c).status) === "missing" ? "missing" : "captured") as "captured" | "missing" }))
    .filter((c) => c.text)
    .slice(0, 6);
  return { capabilities, implementation_considerations, quote_context_requirements };
}

const FIELD_LABEL: Record<string, string> = {
  number_of_users: "Confirmed user count",
  primary_need: "Primary need",
  decision_timeline: "Decision timeline",
  decision_maker: "Decision maker (signer)",
  budget: "Budget context",
  current_solution: "Current solution",
};

function deterministicSolutionContext(args: { retrieved: RetrievedDoc[]; qualification: QualificationView; base: OpportunityIntelligence }): ProductContext {
  const { retrieved, qualification, base } = args;
  const capabilities = retrieved
    .filter((r) => r.doc.category === "capability" || r.doc.category === "integration")
    .slice(0, 3)
    .map((r) => ({ kb_id: r.doc.id, title: r.doc.title, why: `Matched the inquiry on ${r.matched_terms.slice(0, 4).join(", ")}.` }));
  const implementation_considerations = retrieved
    // The pricing-boundary rule is guidance for the AI, not something to tell the salesperson to do.
    .filter((r) => (r.doc.category === "integration" || r.doc.category === "quote_prep") && r.doc.id !== "qp-no-pricing-here")
    .slice(0, 3)
    .map((r) => ({ text: firstSentence(r.doc.content), kb_id: r.doc.id }));
  const quote_context_requirements = [
    ...qualification.captured.map((c) => ({ text: `${FIELD_LABEL[c.field] ?? c.field}: ${c.value}`, status: "captured" as const })),
    ...qualification.missing.map((f) => ({ text: FIELD_LABEL[f] ?? f, status: "missing" as const })),
  ];
  if (base.quote_context.deployment) quote_context_requirements.unshift({ text: `Deployment scope: ${base.quote_context.deployment}`, status: "captured" });
  return { capabilities, implementation_considerations, quote_context_requirements: quote_context_requirements.slice(0, 6) };
}

/* ======================================================= stage 3: evaluator */

interface EvaluatorResult {
  unsupported_claims: { text: string; reason: string }[];
  contradictions: string[];
  verdict: string;
}

const EVALUATOR_SYSTEM = `You are the Readiness Evaluator in Experience.com's Sales Engine. You check a generated opportunity brief against the source record before a salesperson relies on it.

Check for:
1. Unsupported claims — any statement in customer_need, observations, evidence or product_context that asserts a customer fact, number, name, system, date or product capability NOT present in "facts" or in a retrieved knowledge document (ids in retrieved_ids). Pricing, packages, tiers, discounts or amounts are always unsupported.
2. Contradictions — statements that conflict with the record (wrong user count, wrong system, wrong timeline, wrong contact role).
3. Readiness — using qualification_checks, whether this opportunity has what ${DOWNSTREAM.name} needs.

Be strict but literal: paraphrase is fine, invention is not. Quote the offending text exactly as given.

Return JSON: {"unsupported_claims": [{"text": string (exact text), "reason": string}], "contradictions": string[] (each one sentence naming the conflict), "verdict": string (one sentence for the salesperson on readiness for ${DOWNSTREAM.name}, mentioning what is still missing if anything)}`;

function validateEvaluator(raw: unknown): EvaluatorResult {
  const o = obj(raw);
  return {
    unsupported_claims: arr(o.unsupported_claims)
      .map((u) => ({ text: str(obj(u).text), reason: str(obj(u).reason) || "unsupported" }))
      .filter((u) => u.text)
      .slice(0, 10),
    contradictions: strArr(o.contradictions).slice(0, 5),
    verdict: str(o.verdict) || "",
  };
}

/** Commercial language this module must never produce. A customer's own stated budget figure is allowed (it is in the record). */
const COMMERCIAL = /\b(price|pricing|priced|per[- ](?:user|seat)|packages?|tiers?|discounts?|quote amount|licen[cs]e fees?|list price|we (?:can )?offer)\b/i;

interface Evaluation {
  analyst: AnalystResult;
  solution: ProductContext;
  flagged: { text: string; reason: string }[];
  remove: (text: string, reason: string) => void;
}

/**
 * Deterministic guardrail. Removes, rather than merely flags, anything that:
 *  - cites a source id that does not exist on the record,
 *  - cites a knowledge document that was not retrieved,
 *  - contains a number that does not appear anywhere in the record,
 *  - talks about prices, packages, tiers or discounts.
 */
function deterministicEvaluate(args: { analyst: AnalystResult; solution: ProductContext; facts: FactSheet; retrieved: RetrievedDoc[]; qualification: QualificationView; base: OpportunityIntelligence }): Evaluation {
  const { facts, retrieved, base } = args;
  const flagged: { text: string; reason: string }[] = [];
  const retrievedIds = new Set(retrieved.map((r) => r.doc.id));
  const kbText = retrieved.map((r) => `${r.doc.title} ${r.doc.content}`).join(" ").toLowerCase();
  const kbNumbers = new Set((kbText.match(/\d[\d,.]*/g) ?? []).map(normalizeNumber));

  const unsupportedNumber = (text: string) => {
    const nums = (text.match(/\d[\d,.]*/g) ?? []).map(normalizeNumber).filter((n) => n.length > 0);
    return nums.find((n) => !facts.numbers.has(n) && !kbNumbers.has(n)) ?? null;
  };
  const problem = (text: string): string | null => {
    if (COMMERCIAL.test(text)) return "Mentions pricing, packages, tiers or discounts — decided in Quote Ready, not here.";
    const n = unsupportedNumber(text);
    if (n) return `Contains the figure "${n}", which does not appear in the record.`;
    return null;
  };

  // If the need sentence itself fails (e.g. it echoes a customer's request for a price), fall back to the
  // deterministic sentence, and if THAT echoes the same words, to its factual head without the customer's phrasing.
  const safeNeed = () => (problem(base.customer_need) ? `${base.customer_need.split(" — ")[0].replace(/\.$/, "")}.` : base.customer_need);
  const analyst: AnalystResult = { customer_need: args.analyst.customer_need, observations: [], evidence: [], follow_up_questions: [] };
  for (const f of args.analyst.follow_up_questions) {
    const p = problem(`${f.gap} ${f.question}`) ?? (f.source && !facts.sourceIds.includes(f.source) ? `Cites "${f.source}", which is not a record on this opportunity.` : null);
    if (p) flagged.push({ text: `${f.gap}: ${f.question}`, reason: p });
    else analyst.follow_up_questions.push(f);
  }
  const needProblem = problem(analyst.customer_need);
  if (needProblem) {
    flagged.push({ text: analyst.customer_need, reason: needProblem });
    analyst.customer_need = safeNeed();
  }
  for (const o of args.analyst.observations) {
    const p = problem(o);
    if (p) flagged.push({ text: o, reason: p });
    else analyst.observations.push(o);
  }
  for (const e of args.analyst.evidence) {
    const p = facts.sourceIds.includes(e.source) ? problem(e.claim) : `Cites "${e.source}", which is not a record on this opportunity.`;
    if (p) flagged.push({ text: e.claim, reason: p });
    else analyst.evidence.push(e);
  }

  const solution: ProductContext = { capabilities: [], implementation_considerations: [], quote_context_requirements: [] };
  for (const c of args.solution.capabilities) {
    if (!retrievedIds.has(c.kb_id)) flagged.push({ text: `${c.title}: ${c.why}`, reason: `Cites knowledge document "${c.kb_id}", which was not retrieved for this opportunity.` });
    else if (problem(c.why)) flagged.push({ text: c.why, reason: problem(c.why)! });
    else solution.capabilities.push(c);
  }
  for (const c of args.solution.implementation_considerations) {
    const p = c.kb_id && !retrievedIds.has(c.kb_id) ? `Cites knowledge document "${c.kb_id}", which was not retrieved.` : problem(c.text);
    if (p) flagged.push({ text: c.text, reason: p });
    else solution.implementation_considerations.push(c);
  }
  // Requirement status is a fact, not an opinion: re-derive it from qualification.
  const missingLabels = args.qualification.missing.map((f) => (FIELD_LABEL[f] ?? f).toLowerCase());
  for (const r of args.solution.quote_context_requirements) {
    const p = problem(r.text);
    if (p) {
      flagged.push({ text: r.text, reason: p });
      continue;
    }
    const looksMissing = missingLabels.some((l) => r.text.toLowerCase().includes(l.split(" ")[0]));
    solution.quote_context_requirements.push({ text: r.text, status: r.status === "missing" || looksMissing ? "missing" : "captured" });
  }

  const remove = (text: string, reason: string) => {
    const t = text.trim().toLowerCase();
    if (!t) return;
    const hit = (s: string) => s.trim().toLowerCase() === t || s.toLowerCase().includes(t);
    analyst.observations = analyst.observations.filter((o) => !hit(o));
    analyst.evidence = analyst.evidence.filter((e) => !hit(e.claim));
    analyst.follow_up_questions = analyst.follow_up_questions.filter((f) => !hit(f.question) && !hit(f.gap));
    solution.capabilities = solution.capabilities.filter((c) => !hit(c.why));
    solution.implementation_considerations = solution.implementation_considerations.filter((c) => !hit(c.text));
    if (hit(analyst.customer_need)) analyst.customer_need = safeNeed();
    flagged.push({ text, reason });
  };

  return { analyst, solution, flagged, remove };
}

/* ================================================================== helpers */

function dedupe(hits: RetrievedDoc[]): RetrievedDoc[] {
  const seen = new Set<string>();
  return hits.filter((h) => (seen.has(h.doc.id) ? false : (seen.add(h.doc.id), true)));
}
function sentenceList(items: string[]) {
  const t = items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}.`;
}
function firstSentence(s: string) {
  return (s.match(/^[^.!?]+[.!?]/)?.[0] ?? s).trim();
}
function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
function describe(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}
function strArr(v: unknown): string[] {
  return arr(v).map(str).filter(Boolean);
}
