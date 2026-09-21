import Link from "next/link";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { listLeadRows } from "@/lib/repo/leads";
import { listLatestBriefs } from "@/lib/repo/aiBriefs";
import { listOverdueMeetings, listUpcomingMeetings } from "@/lib/repo/schedule";
import { calendarStatus } from "@/lib/calendar/status";
import { getCurrentUser } from "@/lib/auth";
import { buildInsights } from "@/lib/insights";
import { buildTasks, tasksForRole, TASK_KIND_LABELS, type SalesTask, type TaskKind } from "@/lib/tasks";
import { TaskRow, CalendarBadge } from "@/components/dashboard/home-cards";
import { cn } from "@/lib/utils";

/**
 * Scheduled Tasks — the one place to look when you log in.
 *
 * Booked meetings and calls sit in the same list as the work that has no time
 * on it (an unowned opportunity, a qualification gap, the AI's next action),
 * grouped by when it is due rather than by what kind of thing it is, because
 * "what do I have to do" is one question, not two.
 *
 * Nothing here is stored. Every row is derived from an opportunity, an activity
 * or a saved AI brief, so doing the work is what clears it — there is no
 * separate list to tick off and no way for this to drift from the pipeline.
 */
export default async function ScheduledTasksPage({ searchParams }: PageProps<"/tasks">) {
  const params = await searchParams;
  const kind = typeof params.kind === "string" ? params.kind : "all";
  const view = typeof params.view === "string" ? params.view : "all";
  const mineOnly = params.owner === "me";

  const [rows, briefs, upcoming, overdue, user, calendar] = await Promise.all([
    listLeadRows(),
    listLatestBriefs(),
    listUpcomingMeetings(50),
    listOverdueMeetings(50),
    getCurrentUser(),
    calendarStatus(),
  ]);

  // Handoff tasks belong to the role that can perform the handoff.
  const all = tasksForRole(buildTasks(buildInsights(rows, briefs), upcoming, overdue), user?.role ?? "sales");
  const byOwner = mineOnly && user ? all.filter((t) => t.ownerName === user.name) : all;
  const tasks = kind === "all" ? byOwner : byOwner.filter((t) => t.kind === kind);

  const kinds: { key: string; label: string; count: number }[] = [
    { key: "all", label: "All", count: byOwner.length },
    ...(Object.keys(TASK_KIND_LABELS) as TaskKind[])
      .map((k) => ({ key: k, label: TASK_KIND_LABELS[k], count: byOwner.filter((t) => t.kind === k).length }))
      .filter((k) => k.count > 0),
  ];
  const href = (next: { kind?: string; view?: string; owner?: string }) => {
    const p = new URLSearchParams();
    const k = next.kind ?? kind;
    const v = next.view ?? view;
    const o = next.owner ?? (mineOnly ? "me" : "");
    if (v && v !== "all") p.set("view", v);
    if (k && k !== "all") p.set("kind", k);
    if (o) p.set("owner", o);
    const s = p.toString();
    return s ? `/tasks?${s}` : "/tasks";
  };

  // Grouped by when, which is the order a person works through them. The tabs
  // pick one group; "All" shows every group in order, which is the view someone
  // opening the page cold actually wants.
  const isToday = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
  const allGroups: { key: string; title: string; note?: string; tone?: "warn"; items: SalesTask[] }[] = [
    {
      key: "overdue",
      title: "Overdue",
      note: "A booked call has passed with nothing logged since.",
      tone: "warn" as const,
      items: tasks.filter((t) => t.overdue),
    },
    { key: "today", title: "Today", items: tasks.filter((t) => !t.overdue && t.due && isToday(t.due)) },
    { key: "upcoming", title: "Coming up", items: tasks.filter((t) => !t.overdue && t.due && !isToday(t.due)) },
    {
      key: "anytime",
      title: "No date set",
      note: "Work that is waiting on someone rather than on a time.",
      items: tasks.filter((t) => !t.due),
    },
  ];
  const groups = (view === "all" ? allGroups : allGroups.filter((g) => g.key === view)).filter((g) => g.items.length > 0);
  const views = [
    { key: "all", label: "All" },
    { key: "today", label: "Due today" },
    { key: "overdue", label: "Overdue" },
    { key: "upcoming", label: "Upcoming" },
    { key: "anytime", label: "No date" },
  ].map((v) => ({ ...v, count: v.key === "all" ? allGroups.reduce((n, g) => n + g.items.length, 0) : allGroups.find((g) => g.key === v.key)?.items.length ?? 0 }));

  const meetingCount = tasks.filter((t) => t.kind === "call_today" || t.kind === "call_upcoming").length;

  return (
    <div className="mx-auto max-w-5xl px-6 pb-12 pt-8">
      <div className="mb-6">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground">Scheduled Tasks</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Meetings, calls and follow-ups in one list, in the order they need doing. Every row opens the opportunity it came from.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <CalendarBadge status={calendar} />
          {meetingCount > 0 && (
            <span className="inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" /> {meetingCount} booked call{meetingCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      <section className="overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
        {/* When it is due — the primary split. */}
        <div className="flex flex-wrap items-center gap-1 border-b border-border px-4 pt-3">
          {views.map((v) => (
            <Link
              key={v.key}
              href={href({ view: v.key })}
              aria-current={view === v.key ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
                view === v.key
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              )}
            >
              {v.label}
              <span className={cn("tabular-nums", v.key === "overdue" && v.count > 0 && "text-warning")}>{v.count}</span>
            </Link>
          ))}
        </div>

        {/* What kind of thing it is — the secondary split. */}
        <div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {kinds.map((k) => (
              <Link
                key={k.key}
                href={href({ kind: k.key })}
                aria-pressed={kind === k.key}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
                  kind === k.key ? "bg-navy text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {k.label}
                <span className={cn("tabular-nums", kind === k.key ? "text-white/80" : "text-muted-foreground/70")}>{k.count}</span>
              </Link>
            ))}
          </div>
          <Link
            href={href({ owner: mineOnly ? "" : "me" })}
            aria-pressed={mineOnly}
            className={cn(
              "inline-flex shrink-0 items-center rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
              mineOnly ? "bg-navy text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            Mine only
          </Link>
        </div>

        {groups.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">
            {view === "all"
              ? "Nothing scheduled and nothing outstanding. Every opportunity has an owner and qualification is complete."
              : "Nothing in this view."}
          </p>
        ) : (
          groups.map((g) => (
            <div key={g.key}>
              {view === "all" && <div
                className={cn(
                  "flex flex-wrap items-baseline gap-x-3 border-b border-border px-6 py-2",
                  g.tone === "warn" ? "bg-warning/5" : "bg-muted/30"
                )}
              >
                <p className={cn("section-label flex items-center gap-1.5", g.tone === "warn" && "!text-warning")}>
                  {g.tone === "warn" && <AlertTriangle className="h-3.5 w-3.5" />}
                  {g.title}
                </p>
                <span className="text-[12px] tabular-nums text-muted-foreground">{g.items.length}</span>
                {g.note && <span className="text-[12px] text-muted-foreground">{g.note}</span>}
              </div>}
              <ul className="divide-y divide-border px-6 py-2">
                {g.items.map((t) => (
                  <TaskRow key={t.id} task={t} />
                ))}
              </ul>
            </div>
          ))
        )}
      </section>

      <p className="mt-3 text-[12px] text-muted-foreground">
        Calendar settings and the full booking history live on the{" "}
        <Link href="/schedule" className="font-medium text-primary hover:underline">
          Schedule
        </Link>{" "}
        page.
      </p>
    </div>
  );
}
