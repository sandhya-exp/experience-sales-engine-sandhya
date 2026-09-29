/**
 * The stages of one agent-loop run, as the user sees them. Client-safe: the
 * progress UI imports this to label steps; the orchestrator imports it to
 * report them. The keys are the contract between the two.
 *
 *   extract   only for a customer reply: read what the customer wrote
 *   read      load the opportunity record
 *   retrieve  knowledge-base retrieval
 *   analyze   Opportunity Analyst + Solution Context (Claude)
 *   readiness Readiness / Evaluator (Claude review, contradiction check)
 *   propose   decide and draft the next action
 */
export type AiProgressStage = "extract" | "read" | "retrieve" | "analyze" | "readiness" | "propose";

export const AI_STAGES: { key: AiProgressStage; label: string }[] = [
  { key: "extract", label: "Reading the customer's reply" },
  { key: "read", label: "Reading opportunity" },
  { key: "retrieve", label: "Retrieving knowledge" },
  { key: "analyze", label: "Analyzing" },
  { key: "readiness", label: "Checking readiness" },
  { key: "propose", label: "Preparing next action" },
];

export function stagesFor(op: "refresh" | "reply") {
  return op === "reply" ? AI_STAGES : AI_STAGES.filter((s) => s.key !== "extract");
}
