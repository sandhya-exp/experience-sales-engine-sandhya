"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, ArrowRight, Inbox } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { NotificationState } from "@/lib/notifications";
import { cn } from "@/lib/utils";

const POLL_MS = 15_000;

/**
 * 🔔 with a count of inquiries this user hasn't looked at yet. Polls the
 * server so a customer submitting /inquire in another tab lights it up within
 * seconds; opening the menu marks everything seen.
 */
export function NotificationBell({ initial }: { initial: NotificationState }) {
  const [state, setState] = useState(initial);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const res = await fetch("/api/notifications", { cache: "no-store" });
        if (res.ok && !cancelled) setState(await res.json());
      } catch {
        /* offline — keep what we have */
      }
    };
    const id = setInterval(tick, POLL_MS);
    const onFocus = () => void tick();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const seenCutoff = state.seenAt ? new Date(state.seenAt).getTime() : 0;

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next && state.unread > 0) {
          fetch("/api/notifications/seen", { method: "POST" })
            .then((r) => (r.ok ? r.json() : null))
            .then((s) => s && setState(s))
            .catch(() => {});
        }
      }}
    >
      <DropdownMenuTrigger
        aria-label={state.unread > 0 ? `${state.unread} new customer inquiries` : "Notifications"}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        <Bell className="h-[18px] w-[18px]" />
        {state.unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-card">
            {state.unread > 9 ? "9+" : state.unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[340px] p-0">
        <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
          <p className="text-sm font-semibold text-foreground">Notifications</p>
          {state.unread > 0 && <span className="text-xs text-muted-foreground">{state.unread} new</span>}
        </div>
        {state.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
            <Inbox className="h-5 w-5 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No new inquiries in the last 7 days.</p>
          </div>
        ) : (
          <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
            {state.items.map((n) => {
              const fresh = new Date(n.created_at).getTime() > seenCutoff;
              return (
                <li key={n.lead_id} className={cn("px-4 py-3", fresh && "bg-accent/40")}>
                  <div className="flex items-start justify-between gap-3">
                    <p className="section-label !text-[10px] text-primary">{n.source && /inquir|api|website/i.test(n.source) ? "New customer inquiry" : "New lead"}</p>
                    <p className="shrink-0 text-xs text-muted-foreground">{relativeTime(n.created_at)}</p>
                  </div>
                  <p className="mt-0.5 text-sm font-semibold text-foreground">{n.company_name}</p>
                  <p className="text-[13px] text-muted-foreground">
                    {n.contact_name ?? "Contact pending"}
                    {n.number_of_users ? ` · ${n.number_of_users} users` : ""}
                    {n.interest ? ` · ${n.interest}` : ""}
                  </p>
                  <Link
                    href={`/leads/${n.lead_id}`}
                    onClick={() => setOpen(false)}
                    className="mt-1.5 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline"
                  >
                    View Lead <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border px-4 py-2">
          <Link href="/pipeline?stage=new" onClick={() => setOpen(false)} className="text-xs font-medium text-muted-foreground hover:text-foreground">
            See all new leads
          </Link>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function relativeTime(iso: string) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "Just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? "Yesterday" : `${d} days ago`;
}
