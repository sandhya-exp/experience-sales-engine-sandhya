import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import type { AgentActionRow } from "@/lib/repo/agentActions";
import type { AiDealBrief } from "@/lib/types";
import { hasIntelligence } from "@/lib/ai/briefGuards";
import { cn } from "@/lib/utils";

/**
 * One line, at the top of the opportunity: what to do next, and why.
 *
 * The AI tab already carries the agent's full reasoning — the evidence, the
 * trace, the drafted message. That is the right place for it and the wrong
 * place for the answer, because a rep opening a deal should not have to change
 * tab to learn what they are supposed to do. So the conclusion is repeated
 * here, in a sentence, with a link back to the reasoning that produced it.
 *
 * It says nothing when there is nothing to say. A banner that is always present
 * is a banner nobody reads.
 */
export function NextStepBanner({
  leadId,
  brief,
  action,
}: {
  leadId: string;
  brief: AiDealBrief | null;
  action: AgentActionRow | null;
}) {
  const a = action?.meta ?? null;
  // An action the agent is waiting on outranks the general recommendation:
  // something is queued and a person is the reason it has not happened.
  if (a && (a.state === "proposed" || a.state === "approved")) {
    const risk = a.risk === "red" ? "needs your approval" : a.risk === "yellow" ? "drafted for your review" : "ready to run";
    return (
      <Banner tone={a.risk === "red" ? "warning" : "ai"} href={`/leads/${leadId}?tab=brief`} cta="Review it">
        <strong className="font-semibold">AI agent: </strong>
        {a.goal} <span className="text-muted-foreground">— {risk}.</span>
      </Banner>
    );
  }
  if (a && a.state === "executed" && a.action_type === "ask_customer" && !a.replied_at) {
    return (
      <Banner tone="muted" href={`/leads/${leadId}?tab=brief`} cta="See the message">
        <strong className="font-semibold">Waiting on the customer: </strong>
        {a.goal}
      </Banner>
    );
  }

  const next = hasIntelligence(brief) ? brief.intelligence.next_action : null;
  if (!next?.action) return null;
  return (
    <Banner tone="ai" href={`/leads/${leadId}?tab=brief`} cta="Why?">
      <strong className="font-semibold">Next step: </strong>
      {next.action}
      {next.reason && <span className="text-muted-foreground"> — {next.reason}</span>}
    </Banner>
  );
}

function Banner({
  tone,
  href,
  cta,
  children,
}: {
  tone: "ai" | "warning" | "muted";
  href: string;
  cta: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-6xl flex-wrap items-center gap-x-3 gap-y-1.5 rounded-[var(--radius)] border px-4 py-2.5 text-[13px]",
        tone === "warning" ? "border-warning/40 bg-warning/5" : tone === "ai" ? "border-primary/25 bg-accent/50" : "border-border bg-muted/40"
      )}
    >
      <Sparkles className={cn("h-4 w-4 shrink-0", tone === "warning" ? "text-warning" : "text-primary")} />
      <p className="min-w-0 flex-1 text-foreground">{children}</p>
      <Link href={href} className="inline-flex shrink-0 items-center gap-1 text-[12.5px] font-medium text-primary hover:underline">
        {cta} <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  );
}
