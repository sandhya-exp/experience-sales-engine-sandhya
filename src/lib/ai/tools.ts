import type { Activity, Company, Contact, Lead, Qualification } from "@/lib/types";
import { searchKnowledge, type RetrievedDoc, type SearchOptions } from "@/lib/ai/knowledge/retrieval";

/**
 * Tool layer for the AI Opportunity Intelligence workflow.
 *
 * Every piece of data the AI reasons over comes through one of these functions,
 * and every call is recorded in a trace that the UI shows under "AI Process".
 * All tools are READ-ONLY. Nothing in this file (or anything the orchestrator
 * calls) writes to the opportunity — status changes, qualification edits and
 * the Quote Ready handoff stay behind the explicit application actions a
 * person clicks in the workspace.
 */
export interface OpportunityRecord {
  lead: Lead;
  company: Company;
}

/** Where the tools read from: the database in the app, an in-memory fixture in evals. */
export interface OpportunityDataSource {
  getOpportunity(leadId: string): Promise<OpportunityRecord | null>;
  getContacts(companyId: string): Promise<Contact[]>;
  getActivities(leadId: string): Promise<Activity[]>;
}

export interface ToolCall {
  tool: "get_opportunity" | "get_contacts" | "get_activities" | "get_qualification" | "search_knowledge";
  /** Human-readable argument summary — no raw ids for the judge to squint at. */
  input: string;
  /** Human-readable result summary. */
  output: string;
  duration_ms: number;
}

export class ToolTrace {
  readonly calls: ToolCall[] = [];
  async record<T>(tool: ToolCall["tool"], input: string, fn: () => Promise<T> | T, summarize: (r: T) => string): Promise<T> {
    const started = Date.now();
    const result = await fn();
    this.calls.push({ tool, input, output: summarize(result), duration_ms: Date.now() - started });
    return result;
  }
}

export function makeTools(source: OpportunityDataSource, trace: ToolTrace) {
  return {
    getOpportunity: (leadId: string) =>
      trace.record("get_opportunity", "opportunity + company", () => source.getOpportunity(leadId), (r) =>
        r ? `${r.company.name} · ${r.lead.status} · ${r.lead.interest ?? "no interest stated"}` : "not found"
      ),
    getContacts: (companyId: string) =>
      trace.record("get_contacts", "contacts for the company", () => source.getContacts(companyId), (r) => `${r.length} contact${r.length === 1 ? "" : "s"}`),
    getActivities: (leadId: string) =>
      trace.record("get_activities", "activity timeline", () => source.getActivities(leadId), (r) => {
        const kinds = new Map<string, number>();
        for (const a of r) kinds.set(a.type, (kinds.get(a.type) ?? 0) + 1);
        return r.length ? [...kinds].map(([k, n]) => `${n} ${k.replace("_", " ")}`).join(", ") : "no activity yet";
      }),
    getQualification: (lead: Lead) =>
      trace.record("get_qualification", "qualification fields", () => qualificationView(lead), (r) => `${r.captured.length} captured · ${r.missing.length} missing`),
    searchKnowledge: (query: string, opts?: SearchOptions) =>
      trace.record("search_knowledge", `"${truncate(query, 90)}"`, () => searchKnowledge(query, opts), (r: RetrievedDoc[]) =>
        r.length ? r.map((h) => h.doc.title).join(" · ") : "no relevant documents"
      ),
  };
}

export interface QualificationView {
  status: Lead["qualification_status"];
  captured: { field: keyof Qualification; value: string }[];
  missing: (keyof Qualification)[];
}

export function qualificationView(lead: Lead): QualificationView {
  const q = lead.qualification ?? {};
  const fields: (keyof Qualification)[] = ["number_of_users", "primary_need", "decision_timeline", "decision_maker", "budget", "current_solution"];
  const captured: QualificationView["captured"] = [];
  const missing: QualificationView["missing"] = [];
  for (const f of fields) {
    // Same fallbacks as the deterministic intelligence: the inquiry's user count and interest stand in until qualified.
    const v = f === "number_of_users" ? (q.number_of_users ?? lead.number_of_users) : f === "primary_need" ? (q.primary_need ?? lead.interest) : q[f];
    if (v) captured.push({ field: f, value: String(v) });
    else missing.push(f);
  }
  return { status: lead.qualification_status, captured, missing };
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
