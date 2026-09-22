import { redirect } from "next/navigation";
import { Suspense } from "react";
import { getCurrentUser } from "@/lib/auth";
import { canAccessContract } from "@/lib/roles";
import { listLeadRows } from "@/lib/repo/leads";
import { needsAttention } from "@/lib/dashboard";
import { listLatestBriefs } from "@/lib/repo/aiBriefs";
import { listOverdueMeetings, listUpcomingMeetings } from "@/lib/repo/schedule";
import { buildInsights } from "@/lib/insights";
import { buildTasks, tasksForRole } from "@/lib/tasks";
import { listOpenAgentActions } from "@/lib/repo/agentActions";
import { listOpenQuotes } from "@/lib/repo/quotes";
import { Sidebar } from "@/components/shell/sidebar";
import { TopBar } from "@/components/shell/topbar";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const [rows, briefs, upcoming, overdue, agentActions, quotes] = await Promise.all([
    listLeadRows(),
    listLatestBriefs(),
    listUpcomingMeetings(50),
    listOverdueMeetings(50),
    listOpenAgentActions(),
    listOpenQuotes(),
  ]);
  // The sidebar counters read the same derivations the Tasks and Schedule
  // views do, so a badge can never disagree with the list behind it.
  const canContract = canAccessContract(user.role);
  const taskCount = tasksForRole(buildTasks(buildInsights(rows, briefs), upcoming, overdue, agentActions, quotes), user.role).length;
  const attentionCount = rows.filter((r) => needsAttention(r).flagged).length;
  // Quotes still in front of a customer — the one number worth a badge here.
  // Owner and industry are filters now, and live on the Pipeline toolbar.
  const liveQuotes = quotes.filter((q) => !q.meta.superseded && ["sent", "viewed", "approved"].includes(q.meta.status)).length;

  return (
    <div className="flex min-h-screen bg-background">
      <Suspense fallback={<div className="hidden w-60 shrink-0 border-r border-border bg-card lg:block" />}>
        <Sidebar attentionCount={attentionCount} taskCount={taskCount} quoteCount={liveQuotes} canContract={canContract} />
      </Suspense>
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar user={user} />
        <main className="flex-1">{children}</main>
      </div>
    </div>
  );
}
