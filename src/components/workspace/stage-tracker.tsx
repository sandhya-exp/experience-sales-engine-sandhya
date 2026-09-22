import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadStatus } from "@/lib/types";
import type { QuoteStatus } from "@/lib/repo/quotes";

/**
 * Where this deal is, in one line:
 *
 *   Inquiry → Contacted → Qualified → Quote → Contract → Won
 *
 * The first three and the last two are pipeline stages. Quote is the one step
 * that isn't a stage — it's true when the opportunity has a quote — so it is
 * derived from the quotes on the record rather than from `leads.status`. Won
 * completes the track; Lost ends it where it stopped.
 */
type Step = { key: string; label: string; state: "done" | "current" | "todo" | "stopped"; sub?: string };

export function StageTracker({ status, quote }: { status: LeadStatus; quote?: { version: number; status: QuoteStatus } | null }) {
  const order: LeadStatus[] = ["new", "contacted", "qualified", "quoted", "won"];
  const idx = status === "lost" ? -1 : order.indexOf(status);
  const lost = status === "lost";

  const stage = (s: LeadStatus): Step["state"] => {
    const i = order.indexOf(s);
    if (lost) return "todo";
    return i < idx ? "done" : i === idx ? "current" : "todo";
  };

  const quoteState: Step["state"] = quote
    ? quote.status === "accepted" || idx >= 3
      ? "done"
      : "current"
    : idx >= 3
      ? "done"
      : "todo";

  const steps: Step[] = [
    { key: "new", label: "Inquiry", state: stage("new") },
    { key: "contacted", label: "Contacted", state: stage("contacted") },
    { key: "qualified", label: "Qualified", state: quoteState === "current" && stage("qualified") === "current" ? "done" : stage("qualified") },
    { key: "quote", label: "Quote", state: quoteState, sub: quote ? `v${quote.version} · ${quote.status}` : undefined },
    { key: "quoted", label: "Contract", state: stage("quoted") },
    { key: "won", label: "Won", state: stage("won") },
  ];
  if (lost) {
    // Show the stop at the first step nothing reached.
    const firstTodo = steps.findIndex((s) => s.state === "todo");
    steps[Math.max(0, firstTodo)] = { ...steps[Math.max(0, firstTodo)], label: "Lost", state: "stopped" };
  }

  return (
    <ol className="flex flex-wrap items-center gap-y-1" aria-label="Deal progress">
      {steps.map((t, i) => {
        const done = t.state === "done";
        const current = t.state === "current";
        const stopped = t.state === "stopped";
        const isWon = t.key === "won" && (done || current);
        return (
          <li key={t.key} className="flex items-center">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-semibold",
                  (done || isWon) && "border-success bg-success text-white",
                  current && !isWon && "border-navy bg-navy text-white",
                  stopped && "border-destructive bg-destructive text-white",
                  t.state === "todo" && "border-border bg-card text-muted-foreground"
                )}
              >
                {done || isWon ? <Check className="h-3 w-3" /> : stopped ? <X className="h-3 w-3" /> : i + 1}
              </span>
              <span className={cn("whitespace-nowrap text-[12px]", current || stopped ? "font-semibold text-foreground" : done ? "text-foreground" : "text-muted-foreground")}>
                {t.label}
                {t.sub && <span className="ml-1 text-[11px] font-normal text-muted-foreground">{t.sub}</span>}
              </span>
            </div>
            {i < steps.length - 1 && <span className={cn("mx-2 h-px w-5 sm:w-8", done ? "bg-success" : "bg-border")} />}
          </li>
        );
      })}
    </ol>
  );
}
