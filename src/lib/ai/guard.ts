/**
 * The grounding guardrail, in one place.
 *
 * The orchestrator's evaluator has always removed anything it cannot trace back
 * to the record: a figure that appears nowhere, a citation to a source that
 * does not exist, commercial language this module is not allowed to produce.
 * The agent layer has to apply exactly the same rules to the messages it writes
 * to customers, so the primitives live here and both sides import them. One
 * definition, one behaviour — a message the agent drafts is held to the same
 * standard as a sentence in the brief.
 */

/** Commercial language this product must never generate. A customer's own stated budget figure is allowed — it is in the record. */
export const COMMERCIAL = /\b(price|pricing|priced|per[- ](?:user|seat)|packages?|tiers?|discounts?|quote amount|licen[cs]e fees?|list price|we (?:can )?offer)\b/i;

/** Promises the agent is not entitled to make on the company's behalf. */
export const COMMITMENT = /\b(we (?:will|'ll) (?:deliver|deploy|build|complete|guarantee|ship)|guarantee[ds]?|sla|contractual(?:ly)?|we commit|binding|refund)\b/i;

/** Numbers in a string, normalised so "1,200." and "1200" compare equal. */
export function numbersIn(text: string): string[] {
  return (text.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, "").replace(/,/g, "")).filter(Boolean);
}

/** Every lower-cased word in a blob, for checking that a name was not invented. */
export function wordsIn(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z][a-z0-9'&+-]*/g) ?? []);
}

export interface GroundingCorpus {
  /** Every number that legitimately appears in the record or a retrieved document. */
  numbers: Set<string>;
  /** Every word that legitimately appears in the record or a retrieved document. */
  words: Set<string>;
}

export function corpusFrom(...texts: (string | null | undefined)[]): GroundingCorpus {
  const blob = texts.filter(Boolean).join(" ");
  return { numbers: new Set(numbersIn(blob)), words: wordsIn(blob) };
}

/**
 * Why a piece of generated text may not be shown, or null when it is clean.
 * Deliberately literal: paraphrase is fine, invention is not.
 */
export function groundingProblem(text: string, corpus: GroundingCorpus): string | null {
  if (COMMERCIAL.test(text)) return "Mentions pricing, packages, tiers or discounts — those are decided when contracting, not here.";
  if (COMMITMENT.test(text)) return "Makes a commitment or guarantee the Sales Engine is not entitled to make on the company's behalf.";
  const stray = numbersIn(text).find((n) => !corpus.numbers.has(n));
  if (stray) return `Contains the figure "${stray}", which does not appear in the record.`;
  return null;
}

/**
 * Words in `text` that appear nowhere in the corpus and look like a proper noun
 * (a product, a system, a company). Used to catch a drafted message naming a
 * system the customer never mentioned.
 */
export function inventedProperNouns(text: string, corpus: GroundingCorpus, allow: string[] = []): string[] {
  const allowed = new Set(allow.map((a) => a.toLowerCase()));
  const out: string[] = [];
  for (const m of text.match(/\b[A-Z][A-Za-z0-9]{2,}\b/g) ?? []) {
    const lower = m.toLowerCase();
    if (corpus.words.has(lower) || allowed.has(lower) || COMMON_CAPITALS.has(lower)) continue;
    out.push(m);
  }
  return [...new Set(out)];
}

/** Sentence-initial and salutation words that are capitalised for grammar, not because they name anything. */
const COMMON_CAPITALS = new Set(
  (
    "hi hello dear thanks thank best regards kind sincerely the this that these those there here we you your our and but for once could would should can will when what which who how before after also please if it is are was were have has had need needs make sure team sales engine confirm currently your best monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december"
  ).split(" ")
);
