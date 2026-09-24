import type { Company, Contact, Lead, Qualification } from "@/lib/types";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";
import { callClaudeJson, claudeAvailable, claudeModel } from "@/lib/ai/claude";
import { COMMERCIAL } from "@/lib/ai/guard";
import type { ExtractedFact } from "@/lib/ai/reply";

/**
 * Reading a discovery-call transcript.
 *
 * The customer's own reply to an email already has a grounded reading
 * (`lib/ai/reply.ts`): every extracted fact must carry a verbatim quote from
 * what the customer wrote, and a quote that doesn't appear in the source is
 * thrown away before anything is written. A call transcript is the same kind
 * of source — words a real person said — so this module applies the identical
 * discipline to a longer, multi-turn piece of text, and reuses the same
 * `ExtractedFact` shape and the same commercial-language guard so a call and a
 * reply are held to one standard, not two.
 *
 * The one difference from a reply: nothing here is ever written to the
 * opportunity on its own. Extraction only proposes; a salesperson has to
 * confirm which facts to keep before `applyCustomerFacts` (the same function
 * a confirmed reply uses) writes anything — "do not silently modify customer
 * data" applies to a call exactly as it does to an email.
 */
export interface CallRecapExtraction {
  facts: ExtractedFact[];
  /** Systems, tools or products named on the call. */
  systems: { name: string; quote: string }[];
  /** A short, factual summary of the call for the timeline. */
  summary: string;
  /** What the agent should ask about next, if the call left something open. */
  next_action: string | null;
  generated_by: "claude" | "deterministic";
  model: string | null;
  note: string | null;
}

const QUAL_FIELDS: (keyof Qualification)[] = ["number_of_users", "current_solution", "primary_need", "decision_timeline", "decision_maker", "budget"];

const EXTRACT_SYSTEM = `You read the transcript of ONE discovery call between an Experience.com salesperson and a prospective customer, and pull out only the facts the CUSTOMER actually said. You are not summarising the salesperson's side and you are not inferring anything.

Rules — hard constraints:
- Every item must include "quote": a span copied VERBATIM from the transcript that contains the fact. If you cannot quote it, do not report it.
- Only report what the customer said, never something the salesperson proposed, guessed or asked about.
- Do not infer, round, convert or normalise. If they say "about 60", the value is "about 60".
- "field" must be one of: number_of_users, current_solution, primary_need, decision_timeline, decision_maker, budget — or null when the fact does not map to one of those.
- "systems" is for named products, platforms or tools the customer says they use (an MLS, a CRM, an HRIS, a point-of-sale). Name them exactly as the customer said them.
- Never report pricing, discounts or package information as a fact, even if it was discussed on the call; the budget field may carry a figure the customer themselves stated.
- "summary" is 1-2 plain sentences in the third person describing what the call covered and what the customer confirmed.
- "next_action" is one short, concrete suggestion for what the salesperson should do next, grounded only in what the transcript actually says is still open — or null if nothing is left open.

Return JSON: {"facts": [{"field": string|null, "label": string (≤ 5 words), "value": string, "quote": string}], "systems": [{"name": string, "quote": string}], "summary": string, "next_action": string|null}`;

export interface ExtractCallRecapInput {
  transcript: string;
  lead: Lead;
  company: Company;
  contact: Contact | null;
  intelligence: OpportunityIntelligence | null;
  mode?: "auto" | "deterministic";
}

export async function extractCallRecap(input: ExtractCallRecapInput): Promise<CallRecapExtraction> {
  const text = input.transcript.trim();
  if (!text) return { facts: [], systems: [], summary: "", next_action: null, generated_by: "deterministic", model: null, note: "Empty transcript." };

  if (input.mode === "deterministic" || !claudeAvailable()) {
    return { ...deterministicExtraction(text), generated_by: "deterministic", model: null, note: null };
  }

  try {
    const res = await callClaudeJson({
      system: EXTRACT_SYSTEM,
      user: JSON.stringify({
        transcript: text,
        context: {
          customer: input.company.name,
          contact: input.contact?.name ?? null,
          we_already_know: input.intelligence?.gaps.known.map((k) => `${k.label}: ${k.value}`) ?? [],
          we_still_want_to_know: input.intelligence?.gaps.missing.map((m) => m.label) ?? [],
        },
      }),
      validate: validateExtraction,
      maxTokens: 900,
    });
    const grounded = groundExtraction(res.data, text);
    return { ...grounded, generated_by: "claude", model: claudeModel(), note: grounded.note };
  } catch (err) {
    const fallback = deterministicExtraction(text);
    return { ...fallback, generated_by: "deterministic", model: null, note: `Claude was unavailable; the deterministic extraction was used (${err instanceof Error ? err.message : String(err)}).` };
  }
}

function validateExtraction(raw: unknown): { facts: ExtractedFact[]; systems: { name: string; quote: string }[]; summary: string; next_action: string | null } {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const facts = (Array.isArray(o.facts) ? o.facts : [])
    .map((f) => {
      const r = (f && typeof f === "object" ? f : {}) as Record<string, unknown>;
      const field = typeof r.field === "string" && (QUAL_FIELDS as string[]).includes(r.field) ? (r.field as keyof Qualification) : null;
      return { field, label: str(r.label), value: str(r.value), quote: str(r.quote) };
    })
    .filter((f) => f.value && f.quote)
    .slice(0, 8);
  const systems = (Array.isArray(o.systems) ? o.systems : [])
    .map((s) => {
      const r = (s && typeof s === "object" ? s : {}) as Record<string, unknown>;
      return { name: str(r.name), quote: str(r.quote) };
    })
    .filter((s) => s.name && s.quote)
    .slice(0, 4);
  return { facts, systems, summary: str(o.summary), next_action: str(o.next_action) || null };
}

/**
 * The guardrail for extraction: a quote that is not in the transcript means
 * the fact was imagined, so it is dropped before anything reaches the UI —
 * never mind the database.
 */
function groundExtraction(data: { facts: ExtractedFact[]; systems: { name: string; quote: string }[]; summary: string; next_action: string | null }, transcript: string) {
  const haystack = normalise(transcript);
  const dropped: string[] = [];
  const quoted = (q: string) => haystack.includes(normalise(q));

  const facts = data.facts.filter((f) => {
    if (!quoted(f.quote)) {
      dropped.push(`${f.label} — the quote is not in the transcript`);
      return false;
    }
    if (f.field !== "budget" && COMMERCIAL.test(f.value)) {
      dropped.push(`${f.label} — commercial language`);
      return false;
    }
    return true;
  });
  const systems = data.systems.filter((s) => {
    if (!quoted(s.quote) || !normalise(transcript).includes(normalise(s.name))) {
      dropped.push(`${s.name} — not named in the transcript`);
      return false;
    }
    return true;
  });
  return {
    facts,
    systems,
    summary: data.summary,
    next_action: data.next_action,
    note: dropped.length ? `Dropped ${dropped.length} unsupported item${dropped.length === 1 ? "" : "s"}: ${dropped.join("; ")}.` : null,
  };
}

/**
 * Without Claude, the loop still has to work. Same approach as the reply
 * fallback: find a named system and a plain user count, quoting the line each
 * came from. A transcript is longer, so this also looks for "Customer:" style
 * speaker turns and only scans those when the transcript uses them — a call
 * pasted as one paragraph is scanned in full, exactly like a reply.
 */
function deterministicExtraction(transcript: string): { facts: ExtractedFact[]; systems: { name: string; quote: string }[]; summary: string; next_action: string | null; note: string | null } {
  const customerTurns = transcript.match(/^\s*(?:customer|prospect|client)\s*:\s*.+$/gim);
  const scanText = customerTurns && customerTurns.length ? customerTurns.join(" ") : transcript;
  const sentences = scanText
    .replace(/^\s*(?:customer|prospect|client)\s*:\s*/gim, "")
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const systems: { name: string; quote: string }[] = [];
  const facts: ExtractedFact[] = [];

  for (const s of sentences) {
    const m = s.match(/\b(?:we (?:use|are on|'re on|run|have)|our (?:\w+ )?(?:system|platform|crm|mls) is)\s+([A-Z][\w.&-]*(?:\s+[A-Z][\w.&-]*){0,3})/i);
    if (m) systems.push({ name: m[1].replace(/[.,;]$/, "").trim(), quote: s });
    const users = s.match(/\b(\d{1,6})\s+(?:users?|people|employees|agents?|seats?)\b/i);
    if (users && !/\bper\s+(?:branch|office|location|site|store|team)\b/i.test(s) && !facts.some((f) => f.field === "number_of_users")) {
      facts.push({ field: "number_of_users", label: "User count", value: users[1], quote: s });
    }
  }
  const summary = systems.length
    ? `Call transcript processed; customer confirmed they use ${systems.map((s) => s.name).join(" and ")}.`
    : facts.length
      ? `Call transcript processed; customer confirmed ${facts.map((f) => `${f.label.toLowerCase()} ${f.value}`).join(", ")}.`
      : "Call transcript processed; nothing could be extracted automatically.";
  return { facts, systems, summary, next_action: null, note: null };
}

/* ----------------------------------------------------- applying the result */

export interface CallRecapApplication {
  qualificationUpdates: Partial<Qualification>;
  contextLines: string[];
  applied: string[];
}

/**
 * Turn the facts a salesperson confirmed into the smallest set of writes —
 * the same policy `planReplyApplication` uses for a customer reply: a
 * qualification field is only ever filled when it is still empty, never
 * overwritten with a new value, so confirming a call twice — or a call and a
 * reply that happen to repeat a figure — changes nothing the second time.
 *
 * `confirmedIndices` indexes into `facts` first, then `systems` appended
 * after them — the same order the confirmation UI lists them in.
 */
export function planCallRecapApplication(facts: ExtractedFact[], systems: { name: string; quote: string }[], confirmedIndices: number[], lead: Lead, now = new Date()): CallRecapApplication {
  const confirmed = new Set(confirmedIndices);
  const q = lead.qualification ?? {};
  const qualificationUpdates: Partial<Qualification> = {};
  const contextLines: string[] = [];
  const applied: string[] = [];
  const stamp = now.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const existing = (lead.additional_info ?? "").toLowerCase();

  facts.forEach((f, i) => {
    if (!confirmed.has(i)) return;
    if (!f.field) {
      if (!existing.includes(f.value.toLowerCase())) {
        contextLines.push(`Confirmed on call (${stamp}): ${f.label} — ${f.value}.`);
        applied.push(`${f.label}: ${f.value}`);
      }
      return;
    }
    if (f.field === "number_of_users") {
      const n = Number(String(f.value).replace(/[^\d]/g, ""));
      // Never overwrite an already-set count with a different one — the same
      // "fill empty, never overwrite" rule every other qualification field
      // follows here.
      if (Number.isFinite(n) && n > 0 && !q.number_of_users) {
        qualificationUpdates.number_of_users = n;
        applied.push(`User count → ${n}`);
      }
      return;
    }
    if (!q[f.field]) {
      (qualificationUpdates as Record<string, string>)[f.field] = f.value;
      applied.push(`${f.label} → ${f.value}`);
    }
  });

  systems.forEach((s, j) => {
    const idx = facts.length + j;
    if (!confirmed.has(idx)) return;
    if (existing.includes(s.name.toLowerCase())) return;
    contextLines.push(`Confirmed on call (${stamp}): they use ${s.name}.`);
    applied.push(`System named: ${s.name}`);
  });

  return { qualificationUpdates, contextLines, applied };
}

/* ------------------------------------------------------------------ helpers */

function normalise(s: string) {
  return s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();
}

function str(v: unknown) {
  return typeof v === "string" ? v.trim() : "";
}
