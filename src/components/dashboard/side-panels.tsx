import Link from "next/link";
import { AlertTriangle, ArrowRight, Phone, Mail, MessageSquare, StickyNote, RefreshCcw, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { StageBadge } from "@/components/dashboard/leads-table";
import { formatActivityTime, ACTIVITY_TYPE_LABELS } from "@/lib/format";
import type { Activity, LeadListRow } from "@/lib/types";
import { needsAttention } from "@/lib/dashboard";

const ACTIVITY_ICON = {
  call: Phone,
  email: Mail,
  message: MessageSquare,
  note: StickyNote,
  status_change: RefreshCcw,
  qualification_change: RefreshCcw,
};

/** Shared header for the two workflow sections: small label, then a plain-language headline. */
function SectionHeader({ label, title, aside }: { label: string; title: string; aside?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
      <div>
        <p className="section-label">{label}</p>
        <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">{title}</h2>
      </div>
      {aside}
    </div>
  );
}

export function NeedsAttentionPanel({ rows }: { rows: LeadListRow[] }) {
  const all = rows.map((r) => ({ row: r, attention: needsAttention(r) })).filter((x) => x.attention.flagged);
  const flagged = all.slice(0, 4);

  return (
    <Card>
      <SectionHeader
        label="Needs attention"
        title={all.length === 0 ? "Everything is moving" : `${all.length} opportunit${all.length === 1 ? "y needs" : "ies need"} you`}
        aside={
          all.length > 0 && (
            <span className="inline-flex items-center gap-1 rounded-md bg-warning/10 px-2 py-1 text-xs font-medium text-warning">
              <AlertTriangle className="h-3.5 w-3.5" /> {all.length}
            </span>
          )
        }
      />
      <div className="px-6 pb-6">
        {all.length === 0 && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-success" /> No stalled or unqualified opportunities right now.
          </p>
        )}
        <ul className="divide-y divide-border">
          {flagged.map(({ row, attention }) => {
            const missing = row.missing_info.slice(0, 3);
            const more = row.missing_info.length - missing.length;
            return (
              <li key={row.id} className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate font-semibold text-foreground">{row.company_name}</p>
                    <StageBadge status={row.status} />
                  </div>
                  <p className="mt-0.5 flex items-center gap-1 text-[13px] font-medium text-warning">
                    <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {attention.reason}
                  </p>
                  {missing.length > 0 && (
                    <p className="mt-1 text-[13px] text-muted-foreground">
                      <span className="font-medium text-foreground">Missing:</span> {missing.join(", ")}
                      {more > 0 && ` +${more} more`}
                    </p>
                  )}
                </div>
                <Link
                  href={`/leads/${row.id}`}
                  className="mt-0.5 inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 hover:text-primary"
                >
                  Open lead <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </li>
            );
          })}
        </ul>
        {all.length > flagged.length && (
          <Link href="/pipeline?stage=attention" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
            View all {all.length} in the pipeline <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
    </Card>
  );
}

export function RecentActivityPanel({ activities }: { activities: (Activity & { company_name: string })[] }) {
  return (
    <Card>
      <SectionHeader label="Recent activity" title="What happened across the pipeline" />
      <div className="px-6 pb-6">
        {activities.length === 0 && <p className="text-sm text-muted-foreground">No activity logged yet.</p>}
        <ul className="divide-y divide-border">
          {activities.map((activity) => {
            const Icon = ACTIVITY_ICON[activity.type];
            return (
              <li key={activity.id} className="flex gap-3 py-3 first:pt-0 last:pb-0">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-primary">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm">
                      <span className="font-semibold text-foreground">{activity.company_name}</span>
                      <span className="text-muted-foreground"> · {ACTIVITY_TYPE_LABELS[activity.type]}</span>
                    </p>
                    <p className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {formatActivityTime(activity.occurred_at)}
                    </p>
                  </div>
                  {activity.body && <p className="line-clamp-2 text-[13px] text-muted-foreground">{activity.body}</p>}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Card>
  );
}
