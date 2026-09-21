import Link from "next/link";
import { listLeadRows } from "@/lib/repo/leads";
import { listLatestBriefs } from "@/lib/repo/aiBriefs";
import { listOverdueMeetings, listUpcomingMeetings } from "@/lib/repo/schedule";
import { getCurrentUser } from "@/lib/auth";
import { buildInsights } from "@/lib/insights";
import { buildTasks, TASK_KIND_LABELS, type TaskKind } from "@/lib/tasks";
import { TaskRow } from "@/components/dashboard/home-cards";
import { cn } from "@/lib/utils";

/**
 * Tasks & follow-ups — everything waiting on a person, in one list.
 *
 * Each row is derived from a record that already exists: a booked call whose
 * time has passed, a call today, an opportunity with no owner, a qualification
 * gap the AI found, or the AI's recommended next action. Doing the work on the
 * opportunity clears the task; nothing is stored here and nothing to tick off
 * separately, so this list cannot drift from the pipeline.
 */
export default async function TasksPage({ searchParams }: PageProps<"/tasks">) {
  const params = await searchParams;
  const kind = typeof params.kind === "string" ? params.kind : "all";
  const mineOnly = params.owner === "me";

  const [rows, briefs, upcoming, overdue, user] = await Promise.all([
    listLeadRows(),
    listLatestBriefs(),
    listUpcomingMeetings(50),
    listOverdueMeetings(50),
    getCurrentUser(),
  ]);

  const all = buildTasks(buildInsights(rows, briefs), upcoming, overdue);
  const byOwner = mineOnly && user ? all.filter((t) => t.ownerName === user.name) : all;
  const tasks = kind === "all" ? byOwner : byOwner.filter((t) => t.kind === kind);

  const kinds: { key: string; label: string; count: number }[] = [
    { key: "all", label: "All", count: byOwner.length },
    ...(Object.keys(TASK_KIND_LABELS) as TaskKind[]).map((k) => ({
      key: k,
      label: TASK_KIND_LABELS[k],
      count: byOwner.filter((t) => t.kind === k).length,
    })),
  ];
  const href = (next: { kind?: string; owner?: string }) => {
    const p = new URLSearchParams();
    const k = next.kind ?? kind;
    const o = next.owner ?? (mineOnly ? "me" : "");
    if (k && k !== "all") p.set("kind", k);
    if (o) p.set("owner", o);
    const s = p.toString();
    return s ? `/tasks?${s}` : "/tasks";
  };

  const overdueCount = tasks.filter((t) => t.overdue).length;

  return (
    <div className="mx-auto max-w-5xl px-6 pb-12 pt-8">
      <div className="mb-6">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground">Tasks &amp; follow-ups</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          What needs to happen after calls, meetings, qualification gaps and AI recommendations. Every task points at the opportunity that produced it.
        </p>
      </div>

      <section className="overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
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

        {overdueCount > 0 && (
          <p className="border-b border-border bg-warning/5 px-6 py-2 text-[12px] font-medium text-warning">
            {overdueCount} overdue — a booked call has passed with nothing logged since.
          </p>
        )}

        {tasks.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">Nothing here. Every opportunity has an owner, no calls are outstanding and qualification is complete.</p>
        ) : (
          <ul className="divide-y divide-border px-6 py-2">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
