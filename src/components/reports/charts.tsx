import { cn } from "@/lib/utils";
import { compactMoney, percent, type FunnelStep, type MonthPoint } from "@/lib/repo/metrics";

/**
 * The report visuals: a KPI tile, a stage funnel and a month-by-month bar.
 *
 * Deliberately drawn with CSS and inline SVG rather than a charting library.
 * Three charts do not justify a dependency, and keeping them as plain markup
 * means they render on the server with the rest of the page, print correctly,
 * scale down to a phone and inherit the product's own colour tokens instead of
 * a library's palette. A sales manager should be able to read each one in a
 * couple of seconds without a legend.
 */

export function KpiTile({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "success" | "warning";
}) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card px-4 py-3.5 card-shadow">
      <p className="section-label">{label}</p>
      <p
        className={cn(
          "mt-1.5 text-[26px] font-bold leading-none tracking-tight tabular-nums",
          tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground"
        )}
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[12px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/**
 * Stage funnel. Each bar's width is its share of the widest stage, so the
 * narrowing is the point; the numbers beside it say how much was lost at that
 * step and how much of the original intake survived to it.
 */
export function StageFunnel({ steps }: { steps: FunnelStep[] }) {
  const widest = Math.max(...steps.map((s) => s.reached), 1);
  return (
    <div className="space-y-2">
      <div className="hidden grid-cols-[1fr_auto_auto] gap-x-6 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground sm:grid">
        <span>Stage</span>
        <span className="w-24 text-right">Step</span>
        <span className="w-24 text-right">Of all inquiries</span>
      </div>
      {steps.map((step, i) => (
        <div key={step.stage} className="grid grid-cols-[1fr_auto_auto] items-center gap-x-6">
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[13px] font-medium text-foreground">{step.label}</span>
              <span className="shrink-0 text-[13px] font-semibold tabular-nums text-foreground">{step.reached}</span>
            </div>
            <div className="mt-1 h-7 w-full overflow-hidden rounded-md bg-muted">
              <div
                className="h-full rounded-md"
                style={{
                  width: `${Math.max((step.reached / widest) * 100, step.reached > 0 ? 4 : 0)}%`,
                  // A single hue walking from light to deep as the funnel narrows:
                  // the eye reads progression without needing a key.
                  background: `color-mix(in srgb, var(--primary) ${45 + i * 12}%, white)`,
                }}
              />
            </div>
          </div>
          <span className="w-24 text-right text-[13px] tabular-nums text-muted-foreground">
            {step.stepConversion === null ? "—" : percent(step.stepConversion)}
          </span>
          <span className="w-24 text-right text-[13px] font-medium tabular-nums text-foreground">{percent(step.cumulativeConversion)}</span>
        </div>
      ))}
    </div>
  );
}

/** Usable bar height inside the h-44 (176px) plot, less the value label above it. */
const PLOT_PX = 148;

/** Closed-won value by month. Bars are labelled only where there is something to label. */
export function RevenueByMonth({ months }: { months: MonthPoint[] }) {
  const peak = Math.max(...months.map((m) => m.revenue), 1);
  const total = months.reduce((s, m) => s + m.revenue, 0);
  if (total === 0) {
    return <p className="py-10 text-center text-[13px] text-muted-foreground">No closed-won value in this period yet.</p>;
  }
  return (
    <div>
      {/* The bar is sized in pixels against a fixed plot height: a percentage
          height would resolve against an auto-height parent and collapse. */}
      <div className="flex h-44 items-end gap-2">
        {months.map((m) => {
          const height = Math.round(Math.max((m.revenue / peak) * PLOT_PX, m.revenue > 0 ? 6 : 3));
          return (
            <div key={m.month} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
              <span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{m.revenue > 0 ? compactMoney(m.revenue) : ""}</span>
              <div
                className={cn("w-full rounded-t-md", m.revenue > 0 ? "bg-primary/80" : "bg-muted")}
                style={{ height: `${height}px` }}
                title={`${m.label}: ${compactMoney(m.revenue)} from ${m.won} win${m.won === 1 ? "" : "s"}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex gap-2 border-t border-border pt-2">
        {months.map((m) => (
          <div key={m.month} className="min-w-0 flex-1 text-center">
            <p className="text-[11px] font-medium text-foreground">{m.label}</p>
            <p className="text-[10px] tabular-nums text-muted-foreground">{m.won || "—"}</p>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-muted-foreground">Bar height is closed-won value; the number under each month is how many deals closed.</p>
    </div>
  );
}

/**
 * Won against lost, as one bar. The single most-asked question in a pipeline
 * review, and it needs neither axes nor a legend to answer.
 */
export function WinLossBar({ won, lost }: { won: number; lost: number }) {
  const total = won + lost;
  if (total === 0) return <p className="py-6 text-center text-[13px] text-muted-foreground">Nothing has closed in this period.</p>;
  return (
    <div>
      <div className="flex h-8 overflow-hidden rounded-md">
        <div className="flex items-center justify-center bg-success/85 text-[12px] font-semibold text-white" style={{ width: `${(won / total) * 100}%` }}>
          {won > 0 && won}
        </div>
        <div className="flex items-center justify-center bg-muted-foreground/35 text-[12px] font-semibold text-foreground" style={{ width: `${(lost / total) * 100}%` }}>
          {lost > 0 && lost}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-4 text-[12px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-success/85" /> {won} won
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-muted-foreground/35" /> {lost} lost
        </span>
      </div>
    </div>
  );
}
