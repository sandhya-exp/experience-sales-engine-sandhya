import type { Company, Contact, Lead, Qualification } from "@/lib/types";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";
import { callClaudeJson, claudeAvailable, claudeModel } from "@/lib/ai/claude";
import { COMMERCIAL } from "@/lib/ai/guard";

/**
 * Reading the customer's answer.
 *
 * This is the half of the loop that makes the Sales Engine operational rather
 * than analytical: the agent asked a question, the customer replied in their
 * own words, and something has to turn those words into a record the rest of
 * the system already understands.
 *
 * The rule that keeps it honest is simple and mechanical. Every extracted fact
 * must carry a verbatim quote from the reply, and a quote that does not appear
 * in the reply is thrown away before anything is written. So the agent can only
 * ever record what the customer actually said, and the UI can show the customer's
 * own words next to every field it changed.
 */
export interface ExtractedFact {
  /** Which qualification field this sets, when it maps to one. */
  field: keyof Qualification | null;
  label: string;
  value: string;
  /** The customer's own words, verbatim from the reply. */
  quote: string;
}

export interface ReplyExtraction {
  facts: ExtractedFact[];
  /** Systems, tools or products the customer named. These join the opportunity's context. */
  systems: { name: string; quote: string }[];
  /** A short, factual restatement for the timeline. */
  summary: string;
  generated_by: "claude" | "deterministic";
  model: string | null;
  note: string | null;
}

const QUAL_FIELDS: (keyof Qualification)[] = ["number_of_users", "current_solution", "primary_need", "decision_timeline", "decision_maker", "budget"];

const EXTRACT_SYSTEM = `You read ONE reply from a prospective customer and pull out only the facts they actually stated. You are not summarising a conversation and you are not inferring anything.

Rules — hard constraints:
- Every item must include "quote": a span copied VERBATIM from the reply that contains the fact. If you cannot quote it, do not report it.
- Do not infer, round, convert or normalise. If they say "about 60", the value is "about 60".
- Do not report anything the reply does not say, even if it appears in the context.
- "field" must be one of: number_of_users, current_solution, primary_need, decision_timeline, decision_maker, budget — or null when the fact does not map to one of those.
- "systems" is for named products, platforms or tools the customer says they use (an MLS, a CRM, an HRIS, a point-of-sale). Name them exactly as the customer wrote them.
- Never report pricing, discounts or package information as a fact, even if the customer mentions money; the budget field may carry a figure the customer themselves stated.
- "summary" is one plain sentence in the third person describing what the customer confirmed.

Return JSON: {"facts": [{"field": string|null, "label": string (≤ 5 words), "value": string, "quote": string}], "systems": [{"name": string, "quote": string}], "summary": string}`;

export interface ExtractInput {
  replyText: string;
  lead: Lead;
  company: Company;
  contact: Contact | null;
  intelligence: OpportunityIntelligence | null;
  mode?: "auto" | "deterministic";
}

export async function extractFromReply(input: ExtractInput): Promise<ReplyExtraction> {
  const text = input.replyText.trim();
  if (!text) return { facts: [], systems: [], summary: "", generated_by: "deterministic", model: null, note: "Empty reply." };

  if (input.mode === "deterministic" || !claudeAvailable()) {
    return { ...deterministicExtraction(text), generated_by: "deterministic", model: null, note: null };
  }

  try {
    const res = await callClaudeJson({
      system: EXTRACT_SYSTEM,
      user: JSON.stringify({
        reply: text,
        context: {
          customer: input.company.name,
          contact: input.contact?.name ?? null,
          we_asked_about: input.intelligence?.gaps.missing.map((m) => m.label) ?? [],
          already_known: input.intelligence?.quote_context ?? null,
        },
      }),
      validate: validateExtraction,
      maxTokens: 700,
    });
    const grounded = groundExtraction(res.data, text);
    return { ...grounded, generated_by: "claude", model: claudeModel(), note: grounded.note };
  } catch (err) {
    const fallback = deterministicExtraction(text);
    return { ...fallback, generated_by: "deterministic", model: null, note: `Claude was unavailable; the deterministic extraction was used (${err instanceof Error ? err.message : String(err)}).` };
  }
}

function validateExtraction(raw: unknown): { facts: ExtractedFact[]; systems: { name: string; quote: string }[]; summary: string } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const facts = (Array.isArray(o.facts) ? o.facts : [])
    .map((f) => {
      const r = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      const field = typeof r.field === "string" && (QUAL_FIELDS as string[]).includes(r.field) ? (r.field as keyof Qualification) : null;
      return { field, label: str(r.label), value: str(r.value), quote: str(r.quote) };
    })
    .filter((f) => f.value && f.quote)
    .slice(0, 6);
  const systems = (Array.isArray(o.systems) ? o.systems : [])
    .map((s) => {
      const r = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      return { name: str(r.name), quote: str(r.quote) };
    })
    .filter((s) => s.name && s.quote)
    .slice(0, 4);
  return { facts, systems, summary: str(o.summary) };
}

/**
 * The guardrail for extraction: a quote that is not in the reply means the
 * fact was imagined, so it is dropped before anything reaches the database.
 */
function groundExtraction(data: { facts: ExtractedFact[]; systems: { name: string; quote: string }[]; summary: string }, reply: string) {
  const haystack = normalise(reply);
  const dropped: string[] = [];
  const quoted = (q: string) => haystack.includes(normalise(q));

  const facts = data.facts.filter((f) => {
    if (!quoted(f.quote)) {
      dropped.push(`${f.label} — the quote is not in the reply`);
      return false;
    }
    // A customer may state their own budget; the agent may not produce pricing language around it.
    if (f.field !== "budget" && COMMERCIAL.test(f.value)) {
      dropped.push(`${f.label} — commercial language`);
      return false;
    }
    return true;
  });
  const systems = data.systems.filter((s) => {
    if (!quoted(s.quote) || !normalise(reply).includes(normalise(s.name))) {
      dropped.push(`${s.name} — not named in the reply`);
      return false;
    }
    return true;
  });
  return {
    facts,
    systems,
    summary: data.summary,
    note: dropped.length ? `Dropped ${dropped.length} unsupported item${dropped.length === 1 ? "" : "s"}: ${dropped.join("; ")}.` : null,
  };
}

/**
 * Without Claude, the loop still has to work. This finds the two things the
 * agent most often asks for — a named system and a plain number — and nothing
 * else, quoting the sentence it found them in.
 */
function deterministicExtraction(reply: string): { facts: ExtractedFact[]; systems: { name: string; quote: string }[]; summary: string; note: string | null } {
  const sentences = reply.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
  const systems: { name: string; quote: string }[] = [];
  const facts: ExtractedFact[] = [];

  for (const s of sentences) {
    // "We use Bright MLS", "we're on Encompass", "our CRM is Salesforce"
    const m = s.match(/\b(?:we (?:use|are on|'re on|run|have)|our (?:\w+ )?(?:system|platform|crm|mls) is)\s+([A-Z][\w.&-]*(?:\s+[A-Z][\w.&-]*){0,3})/);
    if (m) systems.push({ name: m[1].replace(/[.,;]$/, "").trim(), quote: s });
    const users = s.match(/\b(\d{1,6})\s+(?:users?|people|employees|agents?|seats?)\b/i);
    if (users && !facts.some((f) => f.field === "number_of_users")) {
      facts.push({ field: "number_of_users", label: "User count", value: users[1], quote: s });
    }
  }
  const summary = systems.length
    ? `Customer confirmed they use ${systems.map((s) => s.name).join(" and ")}.`
    : facts.length
      ? `Customer confirmed ${facts.map((f) => `${f.label.toLowerCase()} ${f.value}`).join(", ")}.`
      : "Customer replied; nothing could be extracted automatically.";
  return { facts, systems, summary, note: null };
}

/* ------------------------------------------------------- applying the result */

export interface ReplyApplication {
  qualificationUpdates: Partial<Qualification>;
  /** Attribution lines appended to the opportunity's own context. */
  contextLines: string[];
  applied: string[];
}

/**
 * Turn a grounded extraction into the smallest set of writes. Facts the record
 * already holds are skipped, so re-entering the same reply changes nothing.
 */
export function planReplyApplication(extraction: ReplyExtraction, lead: Lead, now = new Date()): ReplyApplication {
  const q = lead.qualification ?? {};
  const qualificationUpdates: Partial<Qualification> = {};
  const contextLines: string[] = [];
  const applied: string[] = [];
  const stamp = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const existing = (lead.additional_info ?? "").toLowerCase();

  for (const f of extraction.facts) {
    if (!f.field) {
      const line = `Customer confirmed (${stamp}): ${f.label} — ${f.value}.`;
      if (!existing.includes(f.value.toLowerCase())) {
        contextLines.push(line);
        applied.push(`${f.label}: ${f.value}`);
      }
      continue;
    }
    if (f.field === "number_of_users") {
      const n = Number(String(f.value).replace(/[^\d]/g, ""));
      if (Number.isFinite(n) && n > 0 && q.number_of_users !== n) {
        qualificationUpdates.number_of_users = n;
        applied.push(`User count → ${n}`);
      }
      continue;
    }
    if (!q[f.field]) {
      (qualificationUpdates as Record<string, string>)[f.field] = f.value;
      applied.push(`${f.label} → ${f.value}`);
    }
  }

  for (const s of extraction.systems) {
    if (existing.includes(s.name.toLowerCase())) continue;
    contextLines.push(`Customer confirmed (${stamp}): they use ${s.name}.`);
    applied.push(`System named: ${s.name}`);
  }

  return { qualificationUpdates, contextLines, applied };
}

/* ---------------------------------------------------------------- helpers */

function normalise(s: string) {
  return s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

function str(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}
