"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, X } from "lucide-react";
import { DATE_RANGE_LABELS, describeDateFilter, type DateFilter, type DateRange } from "@/lib/dashboard";
import { cn } from "@/lib/utils";

/**
 * Start date → End date, inline in the filter row, matching how a date range
 * reads elsewhere in the Experience.com product: one field showing both ends
 * with a calendar affordance, rather than a dropdown that hides the dates it
 * has applied.
 *
 * The presets live inside the popover instead of taking their own control, so
 * "last 30 days" is one click but the field still always shows the actual range
 * in effect. The filter itself is unchanged — it writes the same
 * range/from/to parameters the pages already parse.
 */
const PRESETS: DateRange[] = ["today", "7d", "30d", "90d"];

export function DateRangeField({ filter, basePath, keep }: { filter: DateFilter; basePath: string; keep: Record<string, string> }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(filter.from ?? "");
  const [to, setTo] = useState(filter.to ?? "");
  const box = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const go = (params: Record<string, string>) => {
    const p = new URLSearchParams(keep);
    for (const [k, v] of Object.entries(params)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    setOpen(false);
    router.push(qs ? `${basePath}?${qs}` : basePath);
  };

  const active = filter.range !== "all";
  const label = active ? describeDateFilter(filter) : null;

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Date range"
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-md border bg-card px-3 text-[13px] transition-colors",
          active ? "border-primary/40 text-foreground" : "border-input text-muted-foreground hover:border-primary/30"
        )}
      >
        {label ? (
          <span className="font-medium text-foreground">{label}</span>
        ) : (
          <span className="flex items-center gap-1.5">
            Start date <span className="text-muted-foreground/60">→</span> End date
          </span>
        )}
        <CalendarDays className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      </button>

      {active && (
        <button
          type="button"
          onClick={() => go({ range: "", from: "", to: "" })}
          aria-label="Clear date range"
          className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:text-foreground"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}

      {open && (
        <div className="absolute left-0 top-9 z-40 w-[19rem] rounded-lg border border-border bg-card p-3 shadow-lg">
          <p className="section-label mb-1.5">Date range</p>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
            <input
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
              aria-label="Start date"
              className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
            <span className="text-xs text-muted-foreground">→</span>
            <input
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
              aria-label="End date"
              className="h-8 min-w-0 rounded-md border border-input bg-background px-2 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
            />
          </div>

          <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-border pt-2.5">
            {PRESETS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => go({ range: r, from: "", to: "" })}
                className={cn(
                  "rounded-md px-2 py-1 text-xs transition-colors",
                  filter.range === r ? "bg-navy text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {DATE_RANGE_LABELS[r]}
              </button>
            ))}
          </div>

          <div className="mt-2.5 flex justify-end gap-1.5">
            <button
              type="button"
              onClick={() => {
                setFrom("");
                setTo("");
                go({ range: "", from: "", to: "" });
              }}
              className="rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              Clear
            </button>
            <button
              type="button"
              disabled={!from && !to}
              onClick={() => go({ range: "custom", from, to })}
              className="rounded-md bg-navy px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
