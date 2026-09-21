"use client";

import { useState } from "react";
import Link from "next/link";
import { Activity, ArrowRight, Loader2, Mail, MessageSquare, Phone, RefreshCcw, StickyNote } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ACTIVITY_TYPE_LABELS, formatActivityTime } from "@/lib/format";
import type { ActivityType } from "@/lib/types";
import { cn } from "@/lib/utils";

export interface RecentActivityItem {
  id: string;
  lead_id: string;
  company_name: string;
  type: ActivityType;
  body: string | null;
  actor_name: string | null;
  occurred_at: string;
}

const ICON: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  call: Phone,
  email: Mail,
  message: MessageSquare,
  note: StickyNote,
  status_change: RefreshCcw,
  qualification_change: RefreshCcw,
};

/**
 * Recent Activity — "what happened", as a compact panel from the header.
 *
 * Deliberately separate from the notification bell, which answers a different
 * question ("what needs my attention"): this one never counts, never marks
 * anything seen and never nags. It re-reads /api/activity/recent each time it
 * opens, so it is current wherever you are in the workspace, and every row
 * opens the opportunity the activity belongs to.
 *
 * Reads only. Nothing here logs an activity or touches the activity model.
 */
export function RecentActivityMenu({ initial = [] }: { initial?: RecentActivityItem[] }) {
  const [items, setItems] = useState<RecentActivityItem[]>(initial);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = async () => {
    setLoading(true);
    setFailed(false);
    try {
      const res = await fetch("/api/activity/recent", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const data = (await res.json()) as { items: RecentActivityItem[] };
      setItems(data.items);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) void load();
      }}
    >
      <DropdownMenuTrigger
        aria-label="Recent activity"
        className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 data-[state=open]:bg-muted"
      >
        <Activity className="h-4 w-4 text-muted-foreground" />
        <span className="hidden sm:inline">Recent Activity</span>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-[360px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <div>
            <p className="text-sm font-semibold text-foreground">Recent activity</p>
            <p className="text-[11px] text-muted-foreground">What happened across the pipeline</p>
          </div>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>

        {failed && <p className="px-4 py-6 text-center text-[13px] text-muted-foreground">Activity couldn&apos;t be loaded right now.</p>}

        {!failed && items.length === 0 && !loading && (
          <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">Nothing logged yet.</p>
        )}

        {!failed && items.length > 0 && (
          <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
            {items.map((a) => {
              const Icon = ICON[a.type] ?? StickyNote;
              return (
                <li key={a.id} className="px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                      <Icon className="h-3.5 w-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="truncate text-[13px] font-semibold text-foreground">{a.company_name}</p>
                        <p className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground">
                          {formatActivityTime(a.occurred_at)}
                        </p>
                      </div>
                      <p className="text-[12px] text-muted-foreground">
                        {ACTIVITY_TYPE_LABELS[a.type]}
                        {a.actor_name && ` · ${a.actor_name}`}
                      </p>
                      {a.body && <p className="mt-0.5 line-clamp-2 text-[12px] text-muted-foreground">{a.body}</p>}
                      <Link
                        href={`/leads/${a.lead_id}`}
                        onClick={() => setOpen(false)}
                        className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-primary hover:underline"
                      >
                        Open lead <ArrowRight className="h-3 w-3" />
                      </Link>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <div className={cn("border-t border-border px-4 py-2")}>
          <Link href="/activity" onClick={() => setOpen(false)} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            View the full activity history
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
