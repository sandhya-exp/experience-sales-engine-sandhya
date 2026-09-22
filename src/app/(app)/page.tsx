import Link from "next/link";
import { listLeadRows } from "@/lib/repo/leads";
import { listLatestBriefs } from "@/lib/repo/aiBriefs";
import { listRecentActivities } from "@/lib/repo/activities";
import { listUpcomingMeetings, listOverdueMeetings } from "@/lib/repo/schedule";
import { calendarStatus } from "@/lib/calendar/status";
import { needsAttention } from "@/lib/dashboard";
import { buildInsights, bucketInsights } from "@/lib/insights";
import { buildTasks, tasksForRole } from "@/lib/tasks";
import { NeedsAttentionPanel } from "@/components/dashboard/side-panels";
import { AiInsightsPanel, NextActionsPanel, QuoteReadyPanel, RecentActivitySummary, TasksPanel, TodayPanel } from "@/components/dashboard/home-cards";
import { AgentActionsPanel } from "@/components/dashboard/agent-actions-panel";
import { SalesJourney } from "@/components/dashboard/sales-journey";
import { AttentionBanner } from "@/components/dashboard/attention-banner";
import { KpiTile, RevenueByMonth } from "@/components/reports/charts";
import { listOpenAgentActions } from "@/lib/repo/agentActions";
import { listOpenQuotes } from "@/lib/repo/quotes";
import { salesMetrics, compactMoney, percent } from "@/lib/repo/metrics";
import { schedulingConfig } from "@/lib/calendar/config";
import { getCurrentUser } from "@/lib/auth";
import { canAccessContract } from "@/lib/roles";
import { cn } from "@/lib/utils";

/**
 * Sales Engine Home — the workspace a salesperson opens first.
 *
 * Three tabs, because the three questions are genuinely different and asking
 * all of them at once is what made this page unreadable. *Overview* is the
 * manager's read: the funnel, the year, six numbers. *My work* is the rep's
 * morning: what is overdue, what is booked, what has gone quiet. *AI actions*
 * is the agent's queue: what it wants to do and what it found.
 *
 * The tab lives in the URL, so the page stays a server component, a link to a
 * tab is shareable, and the browser's back button does the obvious thing.
 * Every panel that was here before is still here — just not all at once.
 */
const TABS = [
  { key: "overview", label: "Overview" },
  { key: "work", label: "My work" },
  { key: "ai", label: "AI actions" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

export default async function HomePage({ searchParams }: PageProps<"/">) {
  const params = await searchParams;
  const tab: TabKey = TABS.some((t) => t.key === params.tab) ? (params.tab as TabKey) : "overview";

  const [rows, user, briefs, recent, upcoming, overdue, calendar, agentActions, quotes, metrics] = await Promise.all([
    listLeadRows(),
    getCurrentUser(),
    listLatestBriefs(),
    listRecentActivities(5),
    listUpcomingMeetings(20),
    listOverdueMeetings(20),
    calendarStatus(),
    listOpenAgentActions(),
    listOpenQuotes(),
    salesMetrics(),
  ]);

  const firstName = user?.name.split(" ")[0];
  const insights = buildInsights(rows, briefs);
  const buckets = bucketInsights(insights);
  // A Sales User's Home ends where their product ends: no contract-boundary
  // card, no ready-to-hand-over stat, no handoff tasks.
  const canContract = canAccessContract(user?.role);
  const tasks = tasksForRole(buildTasks(insights, upcoming, overdue, agentActions, quotes), user?.role ?? "sales");

  const attentionRows = rows.filter((r) => needsAttention(r).flagged);
  const awaitingApproval = quotes.filter((q) => !q.meta.superseded && q.meta.status === "draft" && q.meta.review.needs_approval).length;
  const counts: Record<TabKey, number | undefined> = {
    overview: undefined,
    work: tasks.length || undefined,
    ai: agentActions.length || undefined,
  };

  return (
    <div className="mx-auto max-w-7xl px-6 pb-12 pt-8">
      <div className="mb-5">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground">
          {firstName ? `Welcome back, ${firstName}` : "Sales Engine"}
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">Turn customer inquiries into qualified opportunities, ready to quote.</p>
      </div>

      {/* One line, dismissible, only when something is actually waiting. */}
      <AttentionBanner
        overdue={overdue.length}
        attention={attentionRows.length}
        approvals={canContract ? awaitingApproval : 0}
        agentActions={agentActions.length}
      />

      <nav className="mb-5 flex items-center gap-1 border-b border-border">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "overview" ? "/" : `/?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3.5 py-2.5 text-[14px] font-medium transition-colors",
              tab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
            )}
          >
            {t.label}
            {counts[t.key] !== undefined && (
              <span className={cn("rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums", tab === t.key ? "bg-accent text-primary" : "bg-muted text-muted-foreground")}>
                {counts[t.key]}
              </span>
            )}
          </Link>
        ))}
      </nav>

      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
            <KpiTile label="Open pipeline" value={compactMoney(metrics.openPipelineValue)} sub={`${metrics.openCount} open deals`} />
            <KpiTile label="Revenue (12 mo)" value={compactMoney(metrics.revenueClosed)} sub={`${metrics.wonCount} won`} tone="success" />
            <KpiTile label="Average deal" value={metrics.averageDealSize === null ? "—" : compactMoney(metrics.averageDealSize)} sub="Accepted quotes" />
            <KpiTile label="Win rate" value={percent(metrics.winRate)} sub={`${metrics.wonCount} won · ${metrics.lostCount} lost`} />
            <KpiTile label="Quote conversion" value={percent(metrics.quoteConversion)} sub={`${metrics.quotesAccepted}/${metrics.quotesSent} accepted`} />
            <KpiTile label="Sales cycle" value={metrics.averageCycleDays === null ? "—" : `${metrics.averageCycleDays}d`} sub="Inquiry to won" />
          </div>

          {/* Same stage counts the Reports funnel uses; the KPI row above already
              carries win rate and quote status, so the journey keeps to shape. */}
          <SalesJourney rows={rows} quotes={quotes} funnel={metrics.funnel} showKpis={false} />

          <section className="overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
            <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
              <div>
                <p className="section-label">Revenue</p>
                <h2 className="mt-1 text-[15px] font-semibold tracking-tight text-foreground">Closed-won by month</h2>
              </div>
              <Link href="/reports" className="text-[12px] font-medium text-primary hover:underline">
                Full reports →
              </Link>
            </header>
            <div className="px-5 py-4">
              <RevenueByMonth months={metrics.months} />
            </div>
          </section>
        </div>
      )}

      {tab === "work" && (
        <div className="space-y-4">
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <TasksPanel tasks={tasks} />
            <TodayPanel meetings={upcoming} status={calendar} timeZone={schedulingConfig().timeZone} />
          </div>
          <NeedsAttentionPanel rows={rows} />
          <RecentActivitySummary activities={recent} />
        </div>
      )}

      {tab === "ai" && (
        <div className="space-y-4">
          <AgentActionsPanel actions={agentActions} />
          <div className="grid items-start gap-4 lg:grid-cols-2">
            <AiInsightsPanel buckets={buckets} canContract={canContract} />
            <NextActionsPanel buckets={buckets} />
          </div>
          {canContract && <QuoteReadyPanel buckets={buckets} />}
        </div>
      )}
    </div>
  );
}
