import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";
import { Search, Phone, Mail, MessageSquare, StickyNote, RefreshCcw, ArrowUpRight } from "lucide-react";
import { format, isToday, isYesterday } from "date-fns";
import { listActivityFeed } from "@/lib/repo/activities";
import { parseDateFilter, type DateFilter } from "@/lib/dashboard";
import { activityLabel, formatActivityTime } from "@/lib/format";
import type { ActivityType } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { DateRangeField } from "@/components/dashboard/date-range-field";
import { StageBadge } from "@/components/dashboard/leads-table";
import { cn } from "@/lib/utils";

const ICON = {
  call: Phone,
  email: Mail,
  message: MessageSquare,
  note: StickyNote,
  status_change: RefreshCcw,
  qualification_change: RefreshCcw,
};

const TYPE_FILTERS: { key: "all" | ActivityType; label: string }[] = [
  { key: "all", label: "All" },
  { key: "call", label: "Calls" },
  { key: "email", label: "Emails" },
  { key: "message", label: "Messages" },
  { key: "note", label: "Notes" },
  { key: "status_change", label: "Stage changes" },
  { key: "qualification_change", label: "Qualification" },
];

function inRange(iso: string, f: DateFilter): boolean {
  if (f.range === "all") return true;
  const d = new Date(iso);
  const now = new Date();
  let start: Date | null = null;
  let end: Date | null = null;
  if (f.range === "custom") {
    if (f.from) start = new Date(f.from + "T00:00:00");
    if (f.to) {
      end = new Date(f.to + "T00:00:00");
      end.setDate(end.getDate() + 1);
    }
  } else {
    start = new Date(now);
    if (f.range === "today") start.setHours(0, 0, 0, 0);
    else start.setDate(start.getDate() - (f.range === "7d" ? 7 : f.range === "30d" ? 30 : 90));
  }
  return (!start || d >= start) && (!end || d < end);
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEEE, MMM d, yyyy");
}

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  const params = await searchParams;
  const dateFilter = parseDateFilter(params);
  const industry = typeof params.industry === "string" ? params.industry : "";
  const type = typeof params.type === "string" && TYPE_FILTERS.some((t) => t.key === params.type) ? params.type : "all";
  const q = typeof params.q === "string" ? params.q.toLowerCase().trim() : "";
  const owner = typeof params.owner === "string" ? params.owner : "";
  const me = await getCurrentUser();
  const ownerId = owner === "me" ? me?.id ?? "" : owner;

  const all = await listActivityFeed();
  const rows = all.filter(
    (a) =>
      inRange(a.occurred_at, dateFilter) &&
      (!industry || (a.company_industry ?? "Unspecified") === industry) &&
      (!owner || (owner === "unassigned" ? !a.owner_user_id : a.owner_user_id === ownerId)) &&
      (type === "all" || a.type === type) &&
      (!q || a.company_name.toLowerCase().includes(q) || (a.body ?? "").toLowerCase().includes(q))
  );

  // Preserve date/industry/search when switching type; drop `type` when clearing.
  const keep = new URLSearchParams();
  if (dateFilter.range !== "all") keep.set("range", dateFilter.range);
  if (dateFilter.from) keep.set("from", dateFilter.from);
  if (dateFilter.to) keep.set("to", dateFilter.to);
  if (industry) keep.set("industry", industry);
  if (owner) keep.set("owner", owner);
  if (q) keep.set("q", q);
  const withType = (t: string) => {
    const p = new URLSearchParams(keep);
    if (t !== "all") p.set("type", t);
    const qs = p.toString();
    return qs ? `/activity?${qs}` : "/activity";
  };

  // Group by day
  const groups: { label: string; items: typeof rows }[] = [];
  for (const a of rows) {
    const label = dayLabel(a.occurred_at);
    const g = groups[groups.length - 1];
    if (g && g.label === label) g.items.push(a);
    else groups.push({ label, items: [a] });
  }

  return (
    <div className="mx-auto max-w-7xl px-6 pb-12 pt-8">
      <div className="mb-7">
        <p className="section-label">Recent activity</p>
        <h1 className="mt-1.5 text-[2rem] font-bold leading-tight tracking-tight text-foreground">
          What happened across the pipeline
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Every call, email, message, note and stage change, newest first.
        </p>
      </div>

      <section className="overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
        <div className="flex flex-col gap-3 border-b border-border px-6 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {TYPE_FILTERS.map((t) => (
              <Link
                key={t.key}
                href={withType(t.key)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
                  type === t.key ? "bg-navy text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {t.label}
              </Link>
            ))}
            {industry && (
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{industry}</span>
            )}
            {owner && (
              <span className="rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                {owner === "me" ? "My leads" : owner === "unassigned" ? "Unassigned" : all.find((a) => a.owner_user_id === owner)?.owner_name ?? "Owner"}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <DateRangeField
              filter={dateFilter}
              basePath="/activity"
              keep={{
                ...(type !== "all" ? { type } : {}),
                ...(industry ? { industry } : {}),
                ...(owner ? { owner } : {}),
                ...(q ? { q } : {}),
              }}
            />
            <form className="flex items-center gap-2" action="/activity" role="search">
            {[...keep.entries()].filter(([k]) => k !== "q").map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            {type !== "all" && <input type="hidden" name="type" value={type} />}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder="Filter by company or text" className="h-8 w-full pl-8 text-[13px] sm:w-60" />
              </div>
            </form>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-1 py-16 text-center text-sm text-muted-foreground">
            <p className="font-medium text-foreground">No activity matches this view</p>
            <p>Try another type, date range or industry.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {groups.map((g) => (
              <div key={g.label} className="px-6 py-4">
                <p className="section-label mb-3">{g.label}</p>
                <ul className="space-y-3">
                  {g.items.map((a) => {
                    const Icon = ICON[a.type];
                    return (
                      <li key={a.id} className="flex gap-3">
                        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2 text-sm">
                              <Link href={`/leads/${a.lead_id}`} className="truncate font-semibold text-foreground hover:text-primary">
                                {a.company_name}
                              </Link>
                              <span className="text-muted-foreground">· {activityLabel(a.type, a.metadata)}</span>
                              <StageBadge status={a.lead_status as never} />
                            </div>
                            <p className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                              {formatActivityTime(a.occurred_at)}
                            </p>
                          </div>
                          {a.body && <p className="text-[13px] text-muted-foreground">{a.body}</p>}
                          <p className="mt-0.5 text-xs text-muted-foreground/80">
                            {a.actor_name ?? "System"}
                            {a.company_industry && ` · ${a.company_industry}`}
                            <Link href={`/leads/${a.lead_id}`} className="ml-2 inline-flex items-center gap-0.5 text-primary hover:underline">
                              Open lead <ArrowUpRight className="h-3 w-3" />
                            </Link>
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
