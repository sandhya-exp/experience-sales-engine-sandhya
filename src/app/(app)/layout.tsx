import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { canAccessContract } from "@/lib/roles";
import { listLeadRows } from "@/lib/repo/leads";
import { needsAttention } from "@/lib/dashboard";
import { listTeam } from "@/lib/repo/users";
import { listLatestBriefs } from "@/lib/repo/aiBriefs";
import { listOverdueMeetings, listUpcomingMeetings } from "@/lib/repo/schedule";
import { buildInsights } from "@/lib/insights";
import { buildTasks, tasksForRole } from "@/lib/tasks";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/topbar";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [rows, team, briefs, upcoming, overdue] = await Promise.all([
    listLeadRows(),
    listTeam(),
    listLatestBriefs(),
    listUpcomingMeetings(50),
    listOverdueMeetings(50),
  ]);
  // The sidebar counters read the same derivations the Tasks and Schedule
  // views do, so a badge can never disagree with the list behind it.
  const canContract = canAccessContract(user.role);
  const taskCount = tasksForRole(buildTasks(buildInsights(rows, briefs), upcoming, overdue), user.role).length;
  const attentionCount = rows.filter((r) => needsAttention(r).flagged).length;
  const industryMap = new Map<string, number>();
  for (const r of rows) {
    const key = r.company_industry ?? "Unspecified";
    industryMap.set(key, (industryMap.get(key) ?? 0) + 1);
  }
  const industries = [...industryMap.entries()]
    .map(([industry, count]) => ({ industry, count }))
    .sort((a, b) => b.count - a.count || a.industry.localeCompare(b.industry));
  const unassigned = rows.filter((r) => !r.owner_user_id && r.status !== "won" && r.status !== "lost").length;

  return (
    <div className="flex min-h-screen bg-background">
      <Suspense fallback={<div className="hidden w-64 shrink-0 border-r border-border bg-card lg:block" />}>
        <Sidebar
          attentionCount={attentionCount}
          industries={industries}
          team={team}
          currentUserId={user.id}
          unassignedCount={unassigned}
          taskCount={taskCount}
          canContract={canContract}
        />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
