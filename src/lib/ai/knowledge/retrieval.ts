import { SALES_KNOWLEDGE, type KnowledgeCategory, type KnowledgeDoc } from "@/lib/ai/knowledge/index";

/**
 * Retrieval over the Sales Knowledge Base.
 *
 * A small, dependency-free lexical retriever (TF-IDF style weighting with a
 * boost for tag matches). The corpus is a few dozen short documents, so this
 * is both fast and fully explainable: every hit reports which query terms
 * matched, and that list is what the UI shows as "retrieved because …".
 */
export interface RetrievedDoc {
  doc: KnowledgeDoc;
  score: number;
  matched_terms: string[];
}

const STOP = new Set(
  "a an and are as at be by for from has have in is it its of on or that the to we our us with want wants need needs looking across all use using currently they their them this these those will would can could should also into over per than then there here about after before so see sees get gets every each start starts would just tell your you".split(" ")
);

export function tokenize(text: string): string[] {
  return words(text).map(stem).filter((t) => t.length > 1);
}

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z][a-z0-9+&-]*/g) ?? []).filter((w) => w.length > 1 && !STOP.has(w));
}

/** Very light stemmer — enough to match "surveys"→"survey", "clinics"→"clinic", "listings"→"listing"→"list". */
export function stem(t: string) {
  if (t.length <= 3) return t;
  let s = t.replace(/ies$/, "y").replace(/sses$/, "ss");
  if (/(ing|ed)$/.test(s) && s.replace(/(ing|ed)$/, "").length >= 4) s = s.replace(/(ing|ed)$/, "");
  return s.replace(/([^s])s$/, "$1");
}

interface IndexedDoc {
  doc: KnowledgeDoc;
  tf: Map<string, number>;
  tagTerms: Set<string>;
  length: number;
}

let INDEX: { docs: IndexedDoc[]; idf: Map<string, number> } | null = null;

function buildIndex() {
  const docs: IndexedDoc[] = SALES_KNOWLEDGE.map((doc) => {
    const terms = tokenize(`${doc.title} ${doc.content}`);
    const tf = new Map<string, number>();
    for (const t of terms) tf.set(t, (tf.get(t) ?? 0) + 1);
    const tagTerms = new Set(doc.tags.flatMap((tag) => tokenize(tag)));
    return { doc, tf, tagTerms, length: terms.length };
  });
  const df = new Map<string, number>();
  for (const d of docs) {
    const seen = new Set([...d.tf.keys(), ...d.tagTerms]);
    for (const t of seen) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const idf = new Map<string, number>();
  for (const [t, n] of df) idf.set(t, Math.log(1 + docs.length / n));
  INDEX = { docs, idf };
  return INDEX;
}

export interface SearchOptions {
  limit?: number;
  categories?: KnowledgeCategory[];
  /** Minimum score to be considered a hit (filters noise on long queries). */
  minScore?: number;
}

export function searchKnowledge(queryText: string, opts: SearchOptions = {}): RetrievedDoc[] {
  const { docs, idf } = INDEX ?? buildIndex();
  // Keep the first original spelling of each stem so "matched terms" read naturally in the UI.
  const display = new Map<string, string>();
  for (const w of words(queryText)) if (!display.has(stem(w))) display.set(stem(w), w);
  const qTerms = [...display.keys()];
  if (qTerms.length === 0) return [];
  const limit = opts.limit ?? 4;
  const minScore = opts.minScore ?? 0.6;

  const hits: RetrievedDoc[] = [];
  for (const d of docs) {
    if (opts.categories && !opts.categories.includes(d.doc.category)) continue;
    let score = 0;
    const matched: string[] = [];
    for (const t of qTerms) {
      const w = idf.get(t) ?? 0;
      if (w === 0) continue;
      const tf = d.tf.get(t) ?? 0;
      const inTag = d.tagTerms.has(t);
      if (tf === 0 && !inTag) continue;
      // Saturating TF (BM25-like) so a term repeated ten times doesn't dominate.
      const tfPart = tf ? (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * (d.length / 80))) : 0;
      score += w * (tfPart + (inTag ? 1.5 : 0));
      matched.push(display.get(t) ?? t);
    }
    if (score >= minScore && matched.length) hits.push({ doc: d.doc, score: round(score), matched_terms: matched });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

function round(n: number) {
  return Math.round(n * 100) / 100;
}
