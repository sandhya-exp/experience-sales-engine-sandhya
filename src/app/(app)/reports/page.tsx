import { BarChart3 } from "lucide-react";
import { salesMetrics, windowFor, describeWindow, isMetricRange, compactMoney, percent, type MetricRangeKey } from "@/lib/repo/metrics";
import { KpiTile, RevenueByMonth, StageFunnel, WinLossBar } from "@/components/reports/charts";
import { Panel } from "@/components/dashboard/home-cards";
import { GenerateReportDialog } from "@/components/reports/generate-report";
import { ReportRangeField } from "@/components/reports/report-range";
import { getCurrentUser } from "@/lib/auth";
import { canViewTeamReports } from "@/lib/roles";

/**
 * Reports — the manager's page.
 *
 * Six numbers across the top, then four panels, and that is the whole page.
 * Everything on it is a reading of rows the workspace already wrote: quote
 * totals for money, `status_change` history for stages and cycle length. No
 * forecast, no target, no projection — if the team has not quoted, the money
 * figures are zero rather than estimated.
 */
export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const params = await searchParams;
  const range: MetricRangeKey = isMetricRange(params.range) ? params.range : "12m";
  const from = typeof params.from === "string" ? params.from : null;
  const to = typeof params.to === "string" ? params.to : null;
  const window_ = windowFor(range, new Date(), { from, to });
  const [user, m] = await Promise.all([getCurrentUser(), salesMetrics(window_)]);
  const canSeeTeam = canViewTeamReports(user?.role);

  return (
    <div className="mx-auto max-w-7xl px-6 pb-12 pt-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground">Reports</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">Revenue, conversion and cycle time over {describeWindow(window_)}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ReportRangeField range={range} from={from} to={to} />
          <GenerateReportDialog range={range} from={from} to={to} canSeeTeam={canSeeTeam} />
        </div>
      </div>

      {m.empty ? (
        <div className="rounded-[var(--radius)] border border-dashed border-border bg-card px-6 py-16 text-center">
          <BarChart3 className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-[15px] font-semibold text-foreground">Nothing has closed in this period</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">
            Revenue, win rate and cycle time appear here once opportunities are quoted and closed. Try a longer period.
          </p>
        </div>
      ) : (
        <>
          {/* The six numbers, in the order a pipeline review asks for them. */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="Revenue closed" value={compactMoney(m.revenueClosed)} sub={`${m.wonCount} deal${m.wonCount === 1 ? "" : "s"} won`} tone="success" />
            <KpiTile label="Open pipeline" value={compactMoney(m.openPipelineValue)} sub="Quotes live with a customer" />
            <KpiTile label="Average deal" value={m.averageDealSize === null ? "—" : compactMoney(m.averageDealSize)} sub="Mean accepted quote" />
            <KpiTile label="Win rate" value={percent(m.winRate)} sub={`${m.wonCount} won · ${m.lostCount} lost`} />
            <KpiTile label="Quote conversion" value={percent(m.quoteConversion)} sub={`${m.quotesAccepted} of ${m.quotesSent} accepted`} />
            <KpiTile label="Sales cycle" value={m.averageCycleDays === null ? "—" : `${m.averageCycleDays}d`} sub="Inquiry to won, on average" />
          </div>

          <div className="mt-4 grid items-start gap-4 lg:grid-cols-2">
            <Panel
              label="Funnel"
              title="Stage progression"
              question="Where do opportunities fall out?"
              icon={BarChart3}
              className="lg:col-span-2"
            >
              <StageFunnel steps={m.funnel} />
              <p className="mt-3 border-t border-border pt-2.5 text-[12px] text-muted-foreground">
                Counts every inquiry that arrived in this period and how far it got — including deals that have since closed. &ldquo;Step&rdquo; is the share that
                moved on from the stage above; the last column is the share of all inquiries that reached this stage.
              </p>
            </Panel>

            <Panel label="Revenue" title="Closed-won by month" question="How is the year tracking?" icon={BarChart3}>
              <RevenueByMonth months={m.months} />
            </Panel>

            <Panel label="Outcomes" title="Won against lost" question="What is our strike rate?" icon={BarChart3}>
              <WinLossBar won={m.wonCount} lost={m.lostCount} />
              <dl className="mt-4 space-y-2 border-t border-border pt-3 text-[13px]">
                <Row term="Average time from inquiry to won" value={m.averageCycleDays === null ? "—" : `${m.averageCycleDays} days`} />
                <Row term="Quotes sent" value={String(m.quotesSent)} />
                <Row term="Quotes accepted" value={String(m.quotesAccepted)} />
                <Row term="Open opportunities right now" value={String(m.openCount)} />
              </dl>
            </Panel>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="font-semibold tabular-nums text-foreground">{value}</dd>
    </div>
  );
}
