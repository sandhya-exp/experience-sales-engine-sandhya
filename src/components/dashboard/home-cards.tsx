import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  Clock,
  ExternalLink,
  ListChecks,
  ShieldCheck,
  Sparkles,
  UserPlus,
  Video,
} from "lucide-react";
import { DOWNSTREAM } from "@/lib/modules";
import { StageBadge } from "@/components/dashboard/leads-table";
import { formatActivityTime, ACTIVITY_TYPE_LABELS } from "@/lib/format";
import { TASK_KIND_LABELS, type SalesTask, type TaskKind } from "@/lib/tasks";
import type { InsightBuckets } from "@/lib/insights";
import type { ScheduledItem } from "@/lib/repo/schedule";
import type { CalendarStatus } from "@/lib/calendar/status";
import type { Activity } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The Home workspace cards.
 *
 * Every card answers one question a salesperson actually asks at the start of
 * the day — what needs attention, what happens next, who owns it, what
 * meetings are coming, which opportunities are ready, what is the AI
 * recommending — and every row is a door into the opportunity where the work
 * happens. Nothing here is a vanity metric and nothing here is a new record:
 * tasks, meetings and insights are all readings of the existing opportunity,
 * activity and AI-brief data.
 */

export function Panel({
  label,
  title,
  question,
  icon: Icon,
  action,
  children,
  className,
}: {
  label: string;
  title: string;
  /** The sales question this card answers — shown so a demo explains itself. */
  question?: string;
  icon: React.ComponentType<{ className?: string }>;
  action?: { href: string; label: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow", className)}>
      <header className="flex items-start justify-between gap-4 border-b border-border px-5 py-3.5">
        <div className="min-w-0">
          <p className="section-label flex items-center gap-1.5">
            <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            {label}
          </p>
          <h2 className="mt-1 truncate text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
          {question && <p className="mt-0.5 text-[12px] text-muted-foreground">{question}</p>}
        </div>
        {action && (
          <Link href={action.href} className="mt-0.5 inline-flex shrink-0 items-center gap-1 text-[12px] font-medium text-primary hover:underline">
            {action.label} <ArrowRight className="h-3 w-3" />
          </Link>
        )}
      </header>
      <div className="flex-1 px-5 py-3.5">{children}</div>
    </section>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 py-3 text-[13px] text-muted-foreground">
      <CheckCircle2 className="h-4 w-4 shrink-0 text-success" /> {children}
    </p>
  );
}

/* ------------------------------------------------------------------ tasks */

const TASK_ICON: Record<TaskKind, React.ComponentType<{ className?: string }>> = {
  missed_call: CircleAlert,
  call_today: Clock,
  call_upcoming: Video,
  unassigned: UserPlus,
  qualification_gap: ListChecks,
  ai_next_action: Sparkles,
  quote_handoff: ShieldCheck,
};

export function TasksPanel({ tasks, limit = 5 }: { tasks: SalesTask[]; limit?: number }) {
  const shown = tasks.slice(0, limit);
  const overdue = tasks.filter((t) => t.overdue).length;
  return (
    <Panel
      label="Scheduled Tasks"
      title={tasks.length === 0 ? "Nothing waiting on you" : `${tasks.length} action${tasks.length === 1 ? "" : "s"} to take`}
      question="What happens next, and who owns it?"
      icon={ListChecks}
      action={{ href: "/tasks", label: tasks.length > shown.length ? "See all" : "Open" }}
    >
      {overdue > 0 && (
        <p className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-warning/10 px-2 py-1 text-[12px] font-medium text-warning">
          <AlertTriangle className="h-3.5 w-3.5" /> {overdue} overdue
        </p>
      )}
      {shown.length === 0 && <EmptyLine>No follow-ups, gaps or unassigned opportunities.</EmptyLine>}
      <ul className="divide-y divide-border">
        {shown.map((t) => (
          <TaskRow key={t.id} task={t} />
        ))}
      </ul>
    </Panel>
  );
}

export function TaskRow({ task }: { task: SalesTask }) {
  const Icon = TASK_ICON[task.kind];
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <Link href={task.href} className="group flex items-start gap-3">
        <span
          className={cn(
            "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md",
            task.overdue ? "bg-warning/10 text-warning" : "bg-accent text-primary"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px] font-semibold text-foreground group-hover:text-primary">{task.title}</span>
            <span className="shrink-0 text-[11px] uppercase tracking-wide text-muted-foreground">{TASK_KIND_LABELS[task.kind]}</span>
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">{task.reason}</span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {task.ownerName ?? "Unassigned"}
            {task.due && ` · ${formatActivityTime(task.due)}`}
          </span>
        </span>
      </Link>
    </li>
  );
}

/* --------------------------------------------------------------- meetings */

export function MeetingsPanel({ meetings, status, limit = 4 }: { meetings: ScheduledItem[]; status: CalendarStatus; limit?: number }) {
  const shown = meetings.slice(0, limit);
  return (
    <Panel
      label="Schedule"
      title={meetings.length === 0 ? "No calls booked" : `${meetings.length} call${meetings.length === 1 ? "" : "s"} coming up`}
      question="What meetings are coming, and with whom?"
      icon={CalendarDays}
      action={{ href: "/tasks", label: "Scheduled Tasks" }}
    >
      <CalendarBadge status={status} />
      {shown.length === 0 && <p className="py-3 text-[13px] text-muted-foreground">Customers book discovery calls from Talk to Sales; reps can schedule one from any opportunity.</p>}
      <ul className="mt-1 divide-y divide-border">
        {shown.map((m) => (
          <MeetingRow key={m.activityId} meeting={m} />
        ))}
      </ul>
    </Panel>
  );
}

export function MeetingRow({ meeting: m }: { meeting: ScheduledItem }) {
  const when = new Date(m.scheduledFor);
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <Link href={`/leads/${m.leadId}`} className="group flex items-start gap-3">
        <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
          <Video className="h-3.5 w-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-[13px] font-semibold text-foreground group-hover:text-primary">{m.companyName}</span>
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
              {when.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} ·{" "}
              {when.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
            </span>
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-muted-foreground">
            {m.title}
            {m.contactName && ` · ${m.contactName}`}
            {m.calendar?.rep_name && ` · ${m.calendar.rep_name}`}
          </span>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {m.source === "customer" ? "Booked by the customer" : "Booked by the team"}
            {m.calendar?.provider === "local" && " · demo booking"}
          </span>
        </span>
      </Link>
    </li>
  );
}

/** Never claims Google is connected when it is not — the label comes from the provider itself. */
export function CalendarBadge({ status, className }: { status: CalendarStatus; className?: string }) {
  const live = status.configured;
  return (
    <Link
      href="/schedule"
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium",
        live ? "bg-success/10 text-success" : "bg-warning/10 text-warning",
        className
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", live ? "bg-success" : "bg-warning")} />
      {live
        ? `Google Calendar · live free/busy across ${status.readable.length} ${status.readable.length === 1 ? "calendar" : "calendars"}`
        : "Google Calendar not configured · demo availability"}
    </Link>
  );
}

/* ------------------------------------------------------------ ai insights */

export function AiInsightsPanel({ buckets, canContract = true }: { buckets: InsightBuckets; canContract?: boolean }) {
  const stats: { key: string; label: string; count: number; href: string; tone: "warn" | "ok" | "neutral" }[] = [
    { key: "attention", label: "Need attention", count: buckets.attention.length, href: "/pipeline?stage=attention", tone: "warn" },
    { key: "missing", label: "Missing qualification info", count: buckets.missingInfo.length, href: "/tasks?kind=qualification_gap", tone: "warn" },
    { key: "conflict", label: "Contradictions detected", count: buckets.contradictions.length, href: "/tasks?kind=qualification_gap", tone: "warn" },
    // The readiness stat links into the contract boundary, so it is Admin-only;
    // a Sales User gets the qualified count in its place, which is the same
    // opportunities read from their side of the line.
    canContract
      ? { key: "ready", label: `Ready for ${DOWNSTREAM.name}`, count: buckets.ready.length, href: DOWNSTREAM.route, tone: "ok" as const }
      : { key: "ready", label: "Fully qualified", count: buckets.ready.length, href: "/pipeline?stage=qualified", tone: "ok" as const },
  ];
  const conflict = buckets.contradictions[0];
  const gap = buckets.missingInfo[0];

  return (
    <Panel
      label="AI insights"
      title="What the AI found across the pipeline"
      question="What is the AI recommending, and which opportunities are ready?"
      icon={BrainCircuit}
      action={{ href: "/pipeline", label: "Pipeline" }}
    >
      <ul className="grid grid-cols-2 gap-2">
        {stats.map((s) => (
          <li key={s.key}>
            <Link
              href={s.href}
              className={cn(
                "flex h-full flex-col justify-between rounded-lg border border-border px-3 py-2.5 transition-colors hover:border-primary/40",
                s.count === 0 && "opacity-70"
              )}
            >
              <span
                className={cn(
                  "text-xl font-semibold leading-none tabular-nums",
                  s.count === 0 ? "text-muted-foreground" : s.tone === "warn" ? "text-warning" : s.tone === "ok" ? "text-success" : "text-foreground"
                )}
              >
                {s.count}
              </span>
              <span className="mt-1.5 text-[12px] leading-tight text-muted-foreground">{s.label}</span>
            </Link>
          </li>
        ))}
      </ul>

      {conflict && (
        <div className="mt-3 rounded-lg border border-warning/30 bg-warning/5 px-3 py-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-warning">
            <AlertTriangle className="h-3.5 w-3.5" /> Conflict · {conflict.lead.company_name}
          </p>
          <p className="mt-1 text-[12px] text-foreground">
            {conflict.contradictions[0].topic}: {conflict.contradictions[0].action}
          </p>
          <Link href={`/leads/${conflict.lead.id}`} className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
            Review on the opportunity <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      {!conflict && gap && (
        <div className="mt-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Biggest gap · {gap.lead.company_name}</p>
          <p className="mt-1 text-[12px] text-foreground">Still missing: {gap.missing.slice(0, 3).join(", ")}{gap.missing.length > 3 ? ` +${gap.missing.length - 3}` : ""}</p>
          <Link href={`/leads/${gap.lead.id}`} className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline">
            Open the opportunity <ArrowRight className="h-3 w-3" />
          </Link>
        </div>
      )}

      <p className="mt-3 text-[11px] text-muted-foreground">
        Read from the saved AI Opportunity Intelligence on each opportunity{buckets.claudeCount > 0 && ` · ${buckets.claudeCount} generated with Claude`}
        {buckets.unanalyzed.length > 0 && ` · ${buckets.unanalyzed.length} not analyzed yet`}.
      </p>
    </Panel>
  );
}

/* ----------------------------------------------------------- next actions */

export function NextActionsPanel({ buckets, limit = 5 }: { buckets: InsightBuckets; limit?: number }) {
  const shown = buckets.nextActions.slice(0, limit);
  return (
    <Panel
      label="Next actions"
      title={shown.length === 0 ? "No recommendations yet" : "What the AI says to do next"}
      question="On each open opportunity, what is the single next step?"
      icon={Sparkles}
      action={{ href: "/pipeline", label: "Pipeline" }}
    >
      {shown.length === 0 && <p className="py-3 text-[13px] text-muted-foreground">Recommendations appear once an opportunity has an AI brief.</p>}
      <ul className="divide-y divide-border">
        {shown.map((i) => (
          <li key={i.lead.id} className="py-2.5 first:pt-0 last:pb-0">
            <Link href={`/leads/${i.lead.id}`} className="group block">
              <span className="flex items-center gap-2">
                <span className="truncate text-[13px] font-semibold text-foreground group-hover:text-primary">{i.lead.company_name}</span>
                <StageBadge status={i.lead.status} />
                {i.ready && <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">Quote ready</span>}
              </span>
              <span className="mt-0.5 block text-[12px] text-foreground">{i.nextAction}</span>
              {i.nextActionReason && <span className="mt-0.5 block line-clamp-1 text-[11px] text-muted-foreground">{i.nextActionReason}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* -------------------------------------------------------- recent activity */

export function RecentActivitySummary({ activities }: { activities: (Activity & { company_name: string })[] }) {
  return (
    <Panel
      label="Recent activity"
      title="What just happened"
      question="What has the team already done?"
      icon={Clock}
      action={{ href: "/activity", label: "Full activity" }}
    >
      {activities.length === 0 && <p className="py-3 text-[13px] text-muted-foreground">Nothing logged yet.</p>}
      <ul className="space-y-2">
        {activities.map((a) => (
          <li key={a.id} className="flex items-baseline justify-between gap-3">
            <p className="min-w-0 truncate text-[13px]">
              <Link href={`/leads/${a.lead_id}`} className="font-semibold text-foreground hover:text-primary">
                {a.company_name}
              </Link>
              <span className="text-muted-foreground"> · {ACTIVITY_TYPE_LABELS[a.type]}</span>
              {a.body && <span className="text-muted-foreground"> — {a.body}</span>}
            </p>
            <span className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">{formatActivityTime(a.occurred_at)}</span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ----------------------------------------------------------- quote ready */

export function QuoteReadyPanel({ buckets }: { buckets: InsightBuckets }) {
  const ready = buckets.ready;
  return (
    <Panel
      label={DOWNSTREAM.name}
      title={ready.length === 0 ? "Nothing ready to quote yet" : `${ready.length} ready to quote`}
      question="Which opportunities are ready to hand over?"
      icon={ShieldCheck}
      action={{ href: DOWNSTREAM.route, label: DOWNSTREAM.name }}
    >
      {ready.length === 0 && (
        <p className="py-3 text-[13px] text-muted-foreground">
          An opportunity becomes ready when qualification is complete and the AI finds no unresolved conflicts.
        </p>
      )}
      <ul className="divide-y divide-border">
        {ready.slice(0, 4).map((i) => (
          <li key={i.lead.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
            <div className="min-w-0">
              <p className="truncate text-[13px] font-semibold text-foreground">{i.lead.company_name}</p>
              <p className="truncate text-[12px] text-muted-foreground">
                {i.readinessTotal > 0 && `${i.readinessPassed}/${i.readinessTotal} checks`}
                {i.lead.number_of_users ? ` · ${i.lead.number_of_users} users` : ""}
                {i.lead.owner_name ? ` · ${i.lead.owner_name}` : ""}
              </p>
            </div>
            <Link
              href={`/leads/${i.lead.id}/quote`}
              className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:border-primary/40 hover:text-primary"
            >
              Continue <ExternalLink className="h-3 w-3" />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
