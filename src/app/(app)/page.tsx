import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { listLeadRows } from "@/lib/repo/leads";
import { listLatestBriefs } from "@/lib/repo/aiBriefs";
import { listRecentActivities } from "@/lib/repo/activities";
import { listUpcomingMeetings, listOverdueMeetings } from "@/lib/repo/schedule";
import { calendarStatus } from "@/lib/calendar/status";
import { LEAD_STATUSES } from "@/lib/types";
import type { LeadStatus } from "@/lib/types";
import { needsAttention } from "@/lib/dashboard";
import { buildInsights, bucketInsights } from "@/lib/insights";
import { buildTasks, tasksForRole } from "@/lib/tasks";
import { StatsStrip } from "@/components/dashboard/stats-strip";
import { NeedsAttentionPanel } from "@/components/dashboard/side-panels";
import { AiInsightsPanel, MeetingsPanel, NextActionsPanel, QuoteReadyPanel, RecentActivitySummary, TasksPanel } from "@/components/dashboard/home-cards";
import { getCurrentUser } from "@/lib/auth";
import { canAccessContract } from "@/lib/roles";

/**
 * Sales Engine Home — the workspace a salesperson opens first.
 *
 * Six questions, six cards: where the pipeline stands, what needs attention,
 * what to do next, what meetings are coming, what the AI found, and what the
 * team just did. Everything is a reading of the existing opportunity, activity,
 * AI-brief and calendar data — no new entities, no charts, no vanity metrics —
 * and every row opens the opportunity where the work actually happens.
 */
export default async function HomePage() {
  const [rows, user, briefs, recent, upcoming, overdue, calendar] = await Promise.all([
    listLeadRows(),
    getCurrentUser(),
    listLatestBriefs(),
    listRecentActivities(5),
    listUpcomingMeetings(20),
    listOverdueMeetings(20),
    calendarStatus(),
  ]);

  const firstName = user?.name.split(" ")[0];
  const insights = buildInsights(rows, briefs);
  const buckets = bucketInsights(insights);
  // A Sales User's Home ends where their product ends: no contract-boundary
  // card, no ready-to-hand-over stat, no handoff tasks.
  const canContract = canAccessContract(user?.role);
  const tasks = tasksForRole(buildTasks(insights, upcoming, overdue), user?.role ?? "sales");

  const counts = LEAD_STATUSES.reduce(
    (acc, status) => {
      acc[status] = rows.filter((r) => r.status === status).length;
      return acc;
    },
    {} as Record<LeadStatus, number>
  );
  const open = rows.filter((r) => r.status !== "won" && r.status !== "lost").length;
  const attention = rows.filter((r) => needsAttention(r).flagged).length;
  const mine = rows.filter((r) => r.owner_user_id === user?.id && r.status !== "won" && r.status !== "lost").length;
  const today = new Date().toDateString();
  const newToday = rows.filter((r) => r.status === "new" && new Date(r.created_at).toDateString() === today).length;

  const summary = [
    `${open} open opportunit${open === 1 ? "y" : "ies"}`,
    newToday > 0 && `${newToday} new inquir${newToday === 1 ? "y" : "ies"} today`,
    attention > 0 && `${attention} need${attention === 1 ? "s" : ""} attention`,
    upcoming.length > 0 && `${upcoming.length} call${upcoming.length === 1 ? "" : "s"} booked`,
    `${mine} owned by you`,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-7xl px-6 pb-12 pt-8">
      <div className="mb-6">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground">
          {firstName ? `Welcome back, ${firstName}` : "Sales Engine"}
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">Turn customer inquiries into qualified opportunities, ready to quote.</p>
      </div>

      {/* Pipeline — where every opportunity stands. Each stage opens the pipeline filtered to it. */}
      <div className="mb-2.5 flex items-baseline justify-between">
        <p className="section-label">Pipeline</p>
        <Link href="/pipeline" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
          Open Sales Pipeline <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <StatsStrip counts={counts} activeStage="all" />
      <p className="mt-2.5 text-[13px] text-muted-foreground">{summary.join(" · ")}</p>

      {/* The working cards: what needs you, what to do, what's booked, what the AI found. */}
      <div className="mt-6 grid items-start gap-4 lg:grid-cols-2">
        <TasksPanel tasks={tasks} />
        <MeetingsPanel meetings={upcoming} status={calendar} />
        <AiInsightsPanel buckets={buckets} canContract={canContract} />
        <NextActionsPanel buckets={buckets} />
        {canContract && <QuoteReadyPanel buckets={buckets} />}
        <RecentActivitySummary activities={recent} />
      </div>

      {/* Needs attention keeps its fuller treatment — it is the card people act on most. */}
      <div className="mt-4">
        <NeedsAttentionPanel rows={rows} />
      </div>
    </div>
  );
}
