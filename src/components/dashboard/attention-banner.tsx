"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { ArrowRight, Bell, X } from "lucide-react";

/**
 * The dismissal, as a tiny external store.
 *
 * It is per-browser and lasts a day, which makes it browser storage rather than
 * React state — and reading browser storage during render, or writing it into
 * state from an effect, is exactly what `useSyncExternalStore` exists to avoid.
 * Storage can be unavailable (private windows, blocked site data), so a failed
 * read simply means "not dismissed" and the banner shows.
 */
const KEY = "se.attention.dismissed";
const listeners = new Set<() => void>();

function today() {
  return new Date().toDateString();
}

const store = {
  subscribe(cb: () => void) {
    listeners.add(cb);
    return () => {
      listeners.delete(cb);
    };
  },
  isDismissed() {
    try {
      return window.localStorage.getItem(KEY) === today();
    } catch {
      return false;
    }
  },
  // Hidden while server-rendering, then resolved on hydration: better a banner
  // that arrives a frame late than one that flashes away once it is dismissed.
  serverSnapshot() {
    return true;
  },
  dismiss() {
    try {
      window.localStorage.setItem(KEY, today());
    } catch {
      /* storage unavailable — the banner simply returns on the next load */
    }
    for (const l of listeners) l();
  },
};

/**
 * One line at the top of Home, and only when something is genuinely waiting.
 *
 * Deliberately not a modal and not a toast: a pop-up interrupts whatever the
 * person came here to do, and a toast disappears before they have read it.
 * This sits in the flow, states the count, links to the place that fixes it,
 * and can be dismissed for the rest of the day — the underlying work is still
 * on the Pipeline and Scheduled Tasks pages, so dismissing it hides a reminder
 * rather than the work itself.
 */
export function AttentionBanner({
  overdue,
  attention,
  approvals,
  agentActions,
}: {
  overdue: number;
  attention: number;
  approvals: number;
  agentActions: number;
}) {
  const dismissed = useSyncExternalStore(store.subscribe, store.isDismissed, store.serverSnapshot);

  const items = [
    overdue > 0 && { label: `${overdue} overdue follow-up${overdue === 1 ? "" : "s"}`, href: "/tasks" },
    approvals > 0 && { label: `${approvals} quote${approvals === 1 ? "" : "s"} waiting on your approval`, href: "/quotes?filter=approval" },
    agentActions > 0 && { label: `${agentActions} AI action${agentActions === 1 ? "" : "s"} to review`, href: "/?tab=ai" },
    attention > 0 && { label: `${attention} opportunit${attention === 1 ? "y has" : "ies have"} gone quiet`, href: "/pipeline?stage=attention" },
  ].filter((v): v is { label: string; href: string } => Boolean(v));

  if (dismissed || items.length === 0) return null;

  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius)] border border-warning/40 bg-warning/5 px-4 py-2.5">
      <Bell className="h-4 w-4 shrink-0 text-warning" />
      <p className="text-[13px] font-medium text-foreground">Needs you today</p>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1">
        {items.map((i) => (
          <Link key={i.href} href={i.href} className="inline-flex items-center gap-1 text-[13px] text-foreground/90 hover:text-primary hover:underline">
            {i.label} <ArrowRight className="h-3 w-3" />
          </Link>
        ))}
      </div>
      <button
        type="button"
        aria-label="Dismiss for today"
        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-warning/10 hover:text-foreground"
        onClick={store.dismiss}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
