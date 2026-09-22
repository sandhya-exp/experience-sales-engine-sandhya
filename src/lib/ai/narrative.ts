import type { Company, Contact, Lead } from "@/lib/types";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";
import type { QuoteLineItem } from "@/lib/quotes/math";
import { callClaudeJson, claudeAvailable, claudeModel } from "@/lib/ai/claude";
import { corpusFrom, inventedProperNouns, numbersIn, COMMITMENT } from "@/lib/ai/guard";

/**
 * The quote narrative — the short note that goes out with the numbers.
 *
 * A quote arrives as a table, and a table does not answer the question the
 * customer actually has, which is "is this the thing I asked for?". The rep
 * normally writes two or three sentences to close that gap, and writing them is
 * the moment the deal most often stalls: they are re-reading a six-week thread
 * to remember what the customer said in the first place.
 *
 * So this drafts those sentences, and it is worth being exact about what that
 * means here, because a note that invents a commitment is worse than no note.
 * The draft may only say three kinds of thing: what the customer told us they
 * needed (in their words), what is on the quote (from the line items a person
 * typed), and what happens next. It may not promise an outcome, a timeline or a
 * service level, it may not explain or justify a discount, and it may not name
 * a company, product or system that does not already appear in the record.
 * Every one of those is checked after the model answers, mechanically, and a
 * draft that breaks any of them is discarded rather than shown.
 *
 * Nothing is ever sent from here. The draft lands in the editor as text the rep
 * owns, edits and decides on — the AI writes the first version, the salesperson
 * signs it.
 */
export interface QuoteNarrative {
  /** The note itself, ready to paste into the quote's customer note. */
  note: string;
  /** What the note leans on, so the rep can check it in one glance. */
  grounded_in: string[];
  generated_by: "claude" | "deterministic";
  model: string | null;
  /** Why it fell back, when it did. */
  reason: string | null;
}

const SYSTEM = `You write the short covering note that goes out with a B2B software quote. The reader is the customer contact who asked for it.

You are given: what the customer said they needed, the qualification record, and the exact line items on the quote. Write 2–4 sentences, in the second person, in plain professional English.

Hard constraints — a note that breaks any of these is thrown away:
- Say only three things: what they told us they needed, what this quote covers, and what happens next. Nothing else.
- Use ONLY facts present in the context. Do not name a company, product, system or person that does not appear there.
- Never promise, guarantee or imply an outcome, a result, a delivery date, an implementation timeline, uptime or a service level.
- Never mention, explain, justify or draw attention to a discount, a saving, a list price or how the price was arrived at. You may refer to the quote's total only as "the total below" or not at all.
- Do not invent numbers. Any figure you use must appear verbatim in the context.
- Do not flatter, do not sell, do not use superlatives ("best", "leading", "seamless", "world-class"), and do not open with "Thank you for your interest".
- If the context is thin, write less. A short accurate note beats a padded one.

Return JSON: {"note": string, "grounded_in": string[] (2–4 short phrases naming what in the context you used, e.g. "their stated need: 60 agents on one reputation dashboard")}`;

export interface NarrativeInput {
  lead: Lead;
  company: Company;
  contact: Contact | null;
  intelligence: OpportunityIntelligence | null;
  items: QuoteLineItem[];
  /** What the customer asked about that this quote does not price. */
  notCovered: string[];
  version: number;
}

export async function draftQuoteNarrative(input: NarrativeInput): Promise<QuoteNarrative> {
  const fallback = deterministicNarrative(input);
  if (!claudeAvailable()) return { ...fallback, reason: "Claude is not configured — this is the deterministic draft." };

  // Everything the note is allowed to draw on. The grounding check below reads
  // the same corpus, so "allowed to say" and "checked against" cannot drift.
  const corpus = corpusFor(input);

  try {
    const res = await callClaudeJson<{ note: string; grounded_in: string[] }>({
      system: SYSTEM,
      user: promptFor(input),
      maxTokens: 700,
      validate: (raw) => {
        const r = raw as { note?: unknown; grounded_in?: unknown };
        if (typeof r.note !== "string" || r.note.trim().length < 20) throw new Error("no note");
        const grounded = Array.isArray(r.grounded_in) ? r.grounded_in.filter((g): g is string => typeof g === "string").slice(0, 4) : [];
        return { note: r.note.trim(), grounded_in: grounded };
      },
    });

    const problem = rejectionReason(res.data.note, corpus, input);
    if (problem) return { ...fallback, reason: `Draft rejected (${problem}) — showing the deterministic version.` };

    return { note: res.data.note, grounded_in: res.data.grounded_in, generated_by: "claude", model: res.model, reason: null };
  } catch (err) {
    return { ...fallback, reason: `Claude call failed (${err instanceof Error ? err.message : "unknown"}) — showing the deterministic version.` };
  }
}

/**
 * The checks, in the order a reviewer would apply them. Returns the first
 * failure, or null when the draft is safe to show.
 *
 * Exported because this, not the prompt, is what actually enforces the rules —
 * a prompt is a request and this is the gate — so it is the part worth testing
 * on its own, without a model in the loop.
 */
export function narrativeRejection(note: string, input: NarrativeInput): string | null {
  return rejectionReason(note, corpusFor(input), input);
}

function corpusFor(input: NarrativeInput) {
  return corpusFrom(
    input.lead.requirements,
    input.lead.additional_info,
    input.lead.interest,
    input.company.name,
    input.contact?.name,
    input.contact?.title,
    ...Object.values(input.lead.qualification ?? {}).map((v) => (typeof v === "string" ? v : null)),
    input.intelligence?.customer_need,
    input.intelligence?.quote_context?.primary_need,
    ...input.items.map((i) => i.description),
    ...input.notCovered
  );
}

function rejectionReason(note: string, corpus: ReturnType<typeof corpusFrom>, input: NarrativeInput): string | null {
  if (COMMITMENT.test(note)) return "it promised or guaranteed something";
  // Discounts are a commercial argument the rep makes, not one the AI drafts.
  if (/\b(discount|discounted|saving|savings|off the list|reduced (?:price|rate)|special (?:price|rate))\b/i.test(note)) return "it referred to the discount";
  const invented = inventedProperNouns(note, corpus, [input.company.name, "Experience.com"]);
  if (invented.length) return `it named ${invented.slice(0, 2).join(", ")}, which is not in the record`;

  // Numbers are checked against the record the same way the agent's own
  // messages are. The broader commercial ban that applies to those messages is
  // deliberately NOT reused here: an outbound message may not discuss price at
  // all, but a quote's covering note is attached to one, and saying "Online
  // Listings is not priced here" is the honest thing for it to say. What stays
  // banned — discounts, savings, list prices — is checked above.
  const stray = numbersIn(note).find((n) => !corpus.numbers.has(n));
  if (stray) return `it used the figure "${stray}", which does not appear in the record`;
  return null;
}

function promptFor(i: NarrativeInput): string {
  const q = i.lead.qualification ?? {};
  const lines = [
    `Customer: ${i.company.name}`,
    i.contact ? `Contact: ${i.contact.name}${i.contact.title ? `, ${i.contact.title}` : ""}` : null,
    i.lead.interest ? `What they picked interest in: ${i.lead.interest}` : null,
    i.lead.requirements ? `What they wrote: "${i.lead.requirements}"` : null,
    i.lead.additional_info ? `Also said: "${i.lead.additional_info}"` : null,
    i.intelligence?.customer_need ? `Their need, as summarised from their words: ${i.intelligence.customer_need}` : null,
    "",
    "Qualification record:",
    ...Object.entries(q)
      .filter(([, v]) => typeof v === "string" && v.trim())
      .map(([k, v]) => `- ${k.replace(/_/g, " ")}: ${v}`),
    "",
    `Quote v${i.version} prices exactly these lines:`,
    ...i.items.map((it) => `- ${it.description} × ${it.quantity}`),
    i.notCovered.length ? `\nAsked about but NOT priced on this quote: ${i.notCovered.join(", ")}` : "",
  ];
  return lines.filter((l) => l !== null).join("\n");
}

/**
 * The version with no model behind it.
 *
 * It says less, because it can only assemble what is already written down — but
 * it is never wrong, and it is what a rep gets when Claude is unavailable or
 * when the model's draft failed a check. Both paths produce a note the rep
 * edits; neither produces one that goes out unread.
 */
function deterministicNarrative(i: NarrativeInput): QuoteNarrative {
  const need = i.intelligence?.quote_context?.primary_need ?? i.lead.interest ?? null;
  const who = firstName(i.contact?.name ?? null);
  const users = i.lead.qualification?.number_of_users ?? (i.lead.number_of_users ? String(i.lead.number_of_users) : null);

  const parts: string[] = [];
  // A line item that already names a count ("— 60 agents") makes "for 50 users"
  // read as a contradiction, so the seat count is only added when the lines are
  // silent about it.
  const linesNameACount = i.items.some((it) => /\d/.test(it.description));
  parts.push(`${who ? `${who}, t` : "T"}his quote covers ${listOf(i.items.map((it) => it.description))}${users && !linesNameACount ? ` for ${users} users` : ""}.`);
  if (need) parts.push(`It is built around what you told us you needed: ${need}.`);
  if (i.notCovered.length) parts.push(`${listOf(i.notCovered)} ${i.notCovered.length === 1 ? "is" : "are"} not priced here — happy to walk through ${i.notCovered.length === 1 ? "it" : "those"} separately.`);
  parts.push("The detail is below. Tell us what you would like changed and we will re-issue it.");

  const grounded = [
    need ? `their stated need: ${need}` : null,
    `the ${i.items.length} line${i.items.length === 1 ? "" : "s"} on this quote`,
    users ? `${users} users, from the qualification record` : null,
  ].filter((g): g is string => Boolean(g));

  return { note: parts.join(" "), grounded_in: grounded, generated_by: "deterministic", model: claudeAvailable() ? claudeModel() : null, reason: null };
}

function listOf(values: string[]): string {
  const v = values.filter(Boolean);
  if (v.length === 0) return "the items below";
  if (v.length === 1) return v[0];
  return `${v.slice(0, -1).join(", ")} and ${v[v.length - 1]}`;
}

/** "Dr. Leo Mwangi" → "Leo". An honorific is not a name to greet someone by. */
function firstName(full: string | null): string | null {
  if (!full) return null;
  const parts = full
    .trim()
    .split(/\s+/)
    .filter((w) => !/^(dr|mr|mrs|ms|miss|prof|sir|rev)\.?$/i.test(w));
  const first = parts[0] ?? null;
  return first && first.length > 1 ? first.replace(/[.,]$/, "") : null;
}
