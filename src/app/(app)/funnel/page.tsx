import Link from "next/link";
import { Funnel } from "lucide-react";
import { loadFunnel, FUNNEL_STAGES, type FunnelStage } from "@/lib/repo/funnel";
import { parseDateFilter, describeDateFilter } from "@/lib/dashboard";
import { percent } from "@/lib/repo/metrics";
import { KpiTile } from "@/components/reports/charts";
import { FunnelChart } from "@/components/funnel/funnel-chart";
import { FunnelFilters } from "@/components/funnel/funnel-filters";
import { DateRangeField } from "@/components/dashboard/date-range-field";
import { FunnelCustomers } from "@/components/funnel/funnel-customers";

/**
 * Sales Funnel — the analytical view beside the Pipeline.
 *
 * Pipeline answers "what do I work on?" and moves deals. This answers "where
 * do customers drop out of the journey, how long does each step take, and
 * what is sitting at each step?" — computed from the same leads, activities
 * and quotes, never stored. Every stage is a door: the customers behind the
 * number open below the chart, on the same page.
 */
const STAGE_KEYS = new Set<string>(FUNNEL_STAGES.map((s) => s.key));

export default async function FunnelPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const date = parseDateFilter(params);
  const ownerId = typeof params.owner === "string" && params.owner ? params.owner : null;
  const industry = typeof params.industry === "string" && params.industry ? params.industry : null;
  const source = typeof params.source === "string" && params.source ? params.source : null;
  const stage = typeof params.stage === "string" && STAGE_KEYS.has(params.stage) ? (params.stage as FunnelStage) : null;

  const data = await loadFunnel({ date, ownerId, industry, source });

  const keep: Record<string, string> = {};
  if (date.range !== "all") keep.range = date.range;
  if (date.from) keep.from = date.from;
  if (date.to) keep.to = date.to;
  if (ownerId) keep.owner = ownerId;
  if (industry) keep.industry = industry;
  if (source) keep.source = source;
  const href = (extra: Record<string, string | null>) => {
    const p = new URLSearchParams(keep);
    for (const [k, v] of Object.entries(extra)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    return qs ? `/funnel?${qs}` : "/funnel";
  };

  // The customers behind the selected number.
  const rank = (k: FunnelStage) => FUNNEL_STAGES.findIndex((s) => s.key === k);
  const behind = stage
    ? data.leads.filter((l) => {
        const reached = rank(l.furthest) >= rank(stage);
        return reached;
      })
    : [];
  // One identity holds for every stage: reached = moved to next + lost here + still here.
  const counts = stage
    ? {
        reached: data.leads.filter((l) => rank(l.furthest) >= rank(stage)).length,
        movedNext: data.leads.filter((l) => rank(l.furthest) > rank(stage)).length,
        lostHere: data.leads.filter((l) => l.lost && l.furthest === stage).length,
        stillHere: data.leads.filter((l) => !l.lost && l.current === stage).length,
        won: data.leads.filter((l) => rank(l.furthest) > rank(stage) && l.status === "won").length,
        lostLater: data.leads.filter((l) => rank(l.furthest) > rank(stage) && l.lost).length,
        inJourney: data.leads.filter((l) => rank(l.furthest) > rank(stage) && !l.lost && l.status !== "won").length,
      }
    : null;
  const sorted = [...behind].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const stageStats = stage ? data.stages.find((s) => s.key === stage) : null;
  const nextStage = stage ? data.stages[data.stages.findIndex((s) => s.key === stage) + 1] ?? null : null;
  const filtersOn = Boolean(ownerId || industry || source || date.range !== "all");
  const drop = data.biggestDrop;
  const dropFrom = drop ? FUNNEL_STAGES.find((s) => s.key === drop.from)?.label : null;
  const dropTo = drop ? FUNNEL_STAGES.find((s) => s.key === drop.to)?.label : null;

  return (
    <div className="mx-auto max-w-7xl px-6 pb-12 pt-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground">Sales Funnel</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Understand how customers move, convert, and drop out across the sales journey. To work an individual deal, use the{" "}
            <Link href="/pipeline" className="font-medium text-primary hover:underline">
              Pipeline
            </Link>
            .
          </p>
        </div>
      </div>

      {/* The four numbers a funnel review starts with. */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiTile label="Inquiries" value={String(data.totalInquiries)} sub={describeDateFilter(date)} />
        <KpiTile label="Won" value={String(data.totalWon)} sub={data.overallConversion === null ? "—" : `${percent(data.overallConversion)} inquiry → won`} tone="success" />
        <KpiTile label="Avg. time to win" value={data.avgCycleDays === null ? "—" : `${data.avgCycleDays}d`} sub="Inquiry to won, across wins" />
        <KpiTile
          label="Biggest drop-off"
          value={drop ? percent(drop.share) : "—"}
          sub={drop ? `${dropFrom} → ${dropTo} · ${drop.lost} customer${drop.lost === 1 ? "" : "s"}` : "No drop-off in this view"}
          tone={drop && drop.share >= 0.5 ? "warning" : undefined}
        />
      </div>

      <section className="mt-4 overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
        <div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Funnel className="h-4 w-4 text-navy" />
            Customer journey · each band is everyone who reached that stage; “dropped” is who never made the next one
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <FunnelFilters owners={data.options.owners} industries={data.options.industries} sources={data.options.sources} />
            <DateRangeField filter={date} basePath="/funnel" keep={{ ...(ownerId ? { owner: ownerId } : {}), ...(industry ? { industry } : {}), ...(source ? { source } : {}) }} />
          </div>
        </div>
        {filtersOn && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/30 px-6 py-2 text-[12px] text-muted-foreground">
            <span>
              Showing <span className="font-medium text-foreground">{data.totalInquiries}</span> inquiries
              {" · "}
              {[ownerId ? `owner: ${ownerId === "unassigned" ? "Unassigned" : data.options.owners.find((o) => o.id === ownerId)?.name ?? ownerId}` : "", industry ? `industry: ${industry}` : "", source ? `source: ${source}` : "", date.range !== "all" ? `created: ${describeDateFilter(date)}` : ""]
                .filter(Boolean)
                .join(", ")}
            </span>
            <Link href="/funnel" className="font-medium text-primary hover:underline">
              Clear filters
            </Link>
          </div>
        )}
        <div className="px-6 py-5">
          {data.totalInquiries === 0 ? (
            <p className="rounded-[var(--radius)] border border-dashed border-border py-12 text-center text-[13px] text-muted-foreground">No inquiries match these filters.</p>
          ) : (
            <FunnelChart stages={data.stages} selected={stage} href={(k) => href({ stage: k, show: null })} />
          )}
        </div>
      </section>

      {/* Stage performance, then the customers as evidence. */}
      {stage && stageStats && (
        <section id="stage" className="mt-4 overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
          <div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-[16px] font-semibold text-foreground">
                {stageStats.label} — {stageStats.reached} customer{stageStats.reached === 1 ? "" : "s"} reached this stage
              </h2>
              <p className="mt-1 text-[13px] text-foreground">
                {nextStage ? (
                  <>
                    <span className="font-medium tabular-nums">{counts?.movedNext ?? 0}</span> moved to {nextStage.label} ·{" "}
                  </>
                ) : null}
                <span className="font-medium tabular-nums">{counts?.lostHere ?? 0}</span> lost here · <span className="font-medium tabular-nums">{counts?.stillHere ?? 0}</span> still in this stage
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                {nextStage ? `Conversion to ${nextStage.label}: ${stageStats.reached ? percent(nextStage.reached / stageStats.reached) : "—"} · ` : ""}
                {stageStats.avgDays !== null ? `Average time in stage: ${stageStats.avgDays} days` : "Average time in stage: —"}
                {stageStats.avgDaysHere !== null && stageStats.here > 0 ? ` · Those still here have waited ${stageStats.avgDaysHere} days on average` : ""}
              </p>
              {nextStage && (counts?.movedNext ?? 0) > 0 && (
                <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                  Of those who moved on: <span className="tabular-nums text-foreground">{counts?.won}</span> won · <span className="tabular-nums text-foreground">{counts?.lostLater}</span> lost later ·{" "}
                  <span className="tabular-nums text-foreground">{counts?.inJourney}</span> still in the journey
                </p>
              )}
            </div>
            <Link href={href({ stage: null, show: null })} scroll={false} className="text-[12px] text-muted-foreground hover:text-foreground" aria-label="Close stage detail">
              Close ×
            </Link>
          </div>
          <FunnelCustomers leads={sorted} stage={stage} now={data.now} />
        </section>
      )}
    </div>
  );
}
