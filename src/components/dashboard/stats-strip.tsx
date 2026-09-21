import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { LeadStatus } from "@/lib/types";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/types";

/**
 * Pipeline summary: the six stages as one connected strip — a pipeline you
 * read left to right, not a row of KPI cards. Every stage filters the table
 * below; clicking the active stage clears the filter.
 */
export function StatsStrip({
  counts,
  activeStage,
  keepQuery = "",
}: {
  counts: Record<LeadStatus, number>;
  activeStage: string;
  /** Other active filters (date, industry) to preserve when switching stage. */
  keepQuery?: string;
}) {
  const withRange = (base: string) => (keepQuery ? `${base}${base.includes("?") ? "&" : "?"}${keepQuery}` : base);
  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
      <ol className="grid grid-cols-3 divide-border sm:grid-cols-6 sm:divide-x">
        {LEAD_STATUSES.map((status, i) => {
          const active = activeStage === status;
          const closed = status === "won" || status === "lost";
          const tone = status === "won" ? "text-success" : status === "lost" ? "text-destructive" : "text-foreground";
          return (
            <li key={status} className="relative">
              <Link
                href={withRange(active ? "/pipeline" : `/pipeline?stage=${status}`)}
                aria-pressed={active}
                className={cn(
                  "flex h-full flex-col gap-1.5 px-5 py-4 transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40",
                  active ? "bg-accent" : "hover:bg-muted/60",
                  closed && !active && "bg-muted/30"
                )}
              >
                <span className={cn("section-label flex items-center gap-1", active && "text-primary")}>
                  {LEAD_STATUS_LABELS[status]}
                </span>
                <span className={cn("text-2xl font-semibold leading-none tabular-nums", active ? "text-primary" : tone)}>
                  {counts[status]}
                </span>
              </Link>
              {/* Flow arrows between the working stages; Won / Lost are outcomes, not steps. */}
              {i < 3 && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute -right-2.5 top-1/2 z-10 hidden h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card sm:flex"
                >
                  <ChevronRight className="h-3 w-3 text-muted-foreground" />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
