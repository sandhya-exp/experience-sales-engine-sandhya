import { AiBriefCard } from "@/components/workspace/ai-brief-card";
import { AgentActionCard } from "@/components/workspace/agent-action-card";
import type { AiDealBrief } from "@/lib/types";
import type { AgentActionRow, CustomerReplyMeta } from "@/lib/repo/agentActions";
import type { QuoteSummary } from "@/components/workspace/ai-brief-card";

/**
 * The AI tab: two cards. What the pipeline concluded (AI Summary), then the one
 * thing to do about it (AI Actions). The Act step is appended to the reasoning
 * chain inside the summary's fold, so a reviewer can follow it all the way
 * through — understand, retrieve, decide, check, recommend, act.
 */
export function AiBriefTab({
  leadId,
  brief,
  canContract,
  action,
  autoMode,
  providerLabel,
  lastReply,
  quote,
}: {
  leadId: string;
  brief: AiDealBrief | null;
  canContract: boolean;
  action: AgentActionRow | null;
  autoMode: boolean;
  providerLabel: string;
  lastReply: { occurredAt: string; meta: CustomerReplyMeta } | null;
  /** The active quote, for the summary's status line. */
  quote?: QuoteSummary | null;
}) {
  const actStep = action
    ? {
        text:
          action.meta.state === "executed"
            ? `${action.meta.goal} — done${action.meta.replied_at ? ", customer replied" : action.meta.action_type === "ask_customer" ? ", awaiting reply" : ""}`
            : `${action.meta.goal} — ${action.meta.risk === "green" ? "safe to run" : "needs approval"}`,
        tone: (action.meta.state === "executed" ? "ok" : action.meta.risk === "green" ? "neutral" : "warn") as "neutral" | "ok" | "warn",
      }
    : null;

  return (
    <AiBriefCard
      brief={brief}
      leadId={leadId}
      canContract={canContract}
      actStep={actStep}
      quote={quote}
      agentAction={<AgentActionCard leadId={leadId} action={action} autoMode={autoMode} providerLabel={providerLabel} lastReply={lastReply} />}
    />
  );
}
