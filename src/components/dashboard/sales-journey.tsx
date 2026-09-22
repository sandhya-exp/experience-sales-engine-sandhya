import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { effectiveStatus, type QuoteListRow } from "@/lib/repo/quotes";
import type { FunnelStep } from "@/lib/repo/metrics";
import type { LeadListRow } from "@/lib/types";

/**
 * The five-second read of the pipeline.
 *
 *   Inquiry → Contacted → Qualified → Quote → Contract → Won
 *
 * One funnel, then one row of numbers. The funnel is cumulative — an opportunity
 * that is Won reached every step before it — so the shape shows how far deals
 * get and where they thin out. The row underneath is the handful of figures a
 * manager actually asks for. Everything is a count of records already in the
 * database: leads by stage, quotes by state. Quote amounts are the ones a
 * person typed into a quote; nothing here is estimated.
 */
export function SalesJourney({
  rows,
  quotes,
  funnel,
  showKpis = true,
}: {
  rows: LeadListRow[];
  quotes: QuoteListRow[];
  /** Stage counts from the metrics layer, so this and Reports never disagree. */
  funnel: FunnelStep[];
  /** Off where the page already carries a KPI row of its own. */
  showKpis?: boolean;
}) {
  const live = quotes.filter((q) => !q.meta.superseded);
  const won = rows.filter((r) => r.status === "won").length;
  const lost = rows.filter((r) => r.status === "lost").length;
  const closed = won + lost;
  const winRate = closed ? Math.round((won / closed) * 100) : null;
  const awaitingApproval = live.filter((q) => effectiveStatus(q.meta) === "draft" && q.meta.review.needs_approval && q.leadStatus !== "won" && q.leadStatus !== "lost").length;
  const outWithCustomer = live.filter((q) => ["sent", "viewed"].includes(effectiveStatus(q.meta))).length;

  // Counts come from the funnel: how far each opportunity *ever* got, not where
  // it sits today. Counting current status instead produces the nonsense of a
  // stage showing more than the one before it, because a deal lost after a
  // quote has left every stage it passed through.
  const HREF: Record<string, string> = {
    new: "/pipeline",
    contacted: "/pipeline?stage=contacted",
    qualified: "/pipeline?stage=qualified",
    quoted: "/pipeline?stage=quoted",
    won: "/pipeline?stage=won",
  };
  const LABEL: Record<string, string> = { new: "Inquiry", contacted: "Contacted", qualified: "Qualified", quoted: "Quote sent", won: "Won" };
  const inquiries = funnel[0]?.reached ?? 0;
  const steps = funnel.map((f) => ({
    label: LABEL[f.stage] ?? f.label,
    count: f.reached,
    href: HREF[f.stage] ?? "/pipeline",
    conversion: f.stepConversion,
    tone: f.stage === "won" ? ("ok" as const) : undefined,
  }));

  return (
    <section className="overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
      <div className="px-5 pb-3 pt-4">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <p className="section-label">Pipeline · sales journey</p>
          <Link href="/pipeline" className="text-[12px] font-medium text-primary hover:underline">
            Open Sales Pipeline
          </Link>
        </div>
        <ol className="grid grid-cols-3 gap-x-3 gap-y-3 sm:grid-cols-5">
          {steps.map((s, i) => {
            const conv = s.conversion === null ? null : Math.round(s.conversion * 100);
            const width = inquiries ? Math.max(6, Math.round((s.count / inquiries) * 100)) : 0;
            return (
              <li key={s.label} className="relative min-w-0">
                <Link href={s.href} className="block rounded-lg px-1 py-1 transition-colors hover:bg-muted/60">
                  <p className="section-label truncate">{s.label}</p>
                  <p className={cn("mt-1 text-2xl font-semibold leading-none tabular-nums", s.tone === "ok" ? "text-success" : "text-foreground")}>{s.count}</p>
                  <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div className={cn("h-full rounded-full", s.tone === "ok" ? "bg-success" : "bg-navy")} style={{ width: `${width}%` }} />
                  </div>
                  <p className="mt-1 truncate text-[11px] text-muted-foreground">{i === 0 ? "all" : conv === null ? "—" : `${conv}% of previous`}</p>
                </Link>
                {i < steps.length - 1 && (
                  <span aria-hidden className="pointer-events-none absolute -right-2 top-[26px] hidden h-4 w-4 items-center justify-center rounded-full border border-border bg-card sm:flex">
                    <ChevronRight className="h-2.5 w-2.5 text-muted-foreground" />
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>

      <dl className={cn("grid-cols-2 divide-x divide-border border-t border-border bg-muted/20 sm:grid-cols-4", showKpis ? "grid" : "hidden")}>
        <Kpi label="Win rate" value={winRate === null ? "—" : `${winRate}%`} hint={closed ? `${won} won · ${lost} lost` : "no closed deals yet"} tone={winRate === null ? "muted" : winRate >= 50 ? "ok" : "neutral"} href="/pipeline?stage=won" />
        <Kpi label="Quotes out" value={String(outWithCustomer)} hint="sent, awaiting the customer" tone={outWithCustomer ? "neutral" : "muted"} href="/tasks?kind=quote_follow_up" />
        <Kpi label="Quotes awaiting approval" value={String(awaitingApproval)} hint={awaitingApproval ? "flagged by the check" : "nothing to approve"} tone={awaitingApproval ? "warn" : "muted"} href="/tasks?kind=quote_approval" />
        <Kpi label="Lost" value={String(lost)} hint={lost ? "closed without a deal" : "none lost"} tone={lost ? "neutral" : "muted"} href="/pipeline?stage=lost" />
      </dl>
    </section>
  );
}

function Kpi({ label, value, hint, tone = "neutral", href }: { label: string; value: string; hint: string; tone?: "ok" | "warn" | "neutral" | "muted"; href: string }) {
  return (
    <div className="min-w-0">
      <Link href={href} className="block px-5 py-2.5 transition-colors hover:bg-muted/60">
        <dt className="section-label truncate">{label}</dt>
        <dd className={cn("mt-0.5 text-xl font-semibold leading-none tabular-nums", tone === "ok" ? "text-success" : tone === "warn" ? "text-warning" : tone === "muted" ? "text-muted-foreground" : "text-foreground")}>{value}</dd>
        <dd className="mt-0.5 truncate text-[11px] text-muted-foreground">{hint}</dd>
      </Link>
    </div>
  );
}
