import type { AiDealBrief } from "@/lib/types";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";

/**
 * Does this brief carry structured intelligence?
 *
 * Briefs written before the grounded workflow existed have `{}` there, so every
 * reader has to check. The guard lives here rather than in the card component
 * because server code (the agent loop) needs it too, and server code should not
 * import a React component to get at a type predicate.
 */
export function hasIntelligence(brief: AiDealBrief | null): brief is AiDealBrief & { intelligence: OpportunityIntelligence } {
  return Boolean(brief && brief.intelligence && "quote_context" in brief.intelligence);
}
