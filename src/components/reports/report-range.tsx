"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays, X } from "lucide-react";
import { METRIC_RANGES, type MetricRangeKey } from "@/lib/reports/ranges";
import { cn } from "@/lib/utils";

/**
 * The period the Reports dashboard is measured over.
 *
 * Same idea as the pipeline's date field — one control that always shows the
 * range actually in effect, with the presets inside it rather than taking their
 * own row — but the presets are the ones a report needs (months and quarters,
 * not days) and it writes `range` or `from`/`to` for the metrics layer to read.
 */
export function ReportRangeField({ range, from, to }: { range: MetricRangeKey; from: string | null; to: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(from ?? "");
  const [end, setEnd] = useState(to ?? "");
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
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
    const qs = p.toString();
    setOpen(false);
    router.push(qs ? `/reports?${qs}` : "/reports");
  };

  const custom = Boolean(from || to);
  const label = custom
    ? `${from ? fmt(from) : "Everything"} – ${to ? fmt(to) : "today"}`
    : METRIC_RANGES.find((r) => r.key === range)?.label ?? "Last 12 months";

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-input bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:bg-muted/50"
      >
        <CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />
        {label}
        {custom && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear date range"
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              go({});
            }}
            onKeyDown={(e) => e.key === "Enter" && go({})}
          >
            <X className="h-3 w-3" />
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-1.5 w-72 rounded-lg border border-border bg-card p-3 shadow-lg">
          <p className="section-label mb-1.5">Period</p>
          <div className="flex flex-wrap gap-1.5">
            {METRIC_RANGES.map((r) => (
              <button
                key={r.key}
                type="button"
                onClick={() => go(r.key === "12m" ? {} : { range: r.key })}
                className={cn(
                  "rounded-md border px-2 py-1 text-[12.5px] font-medium transition-colors",
                  !custom && range === r.key ? "border-navy bg-navy text-white" : "border-border bg-card text-foreground hover:border-navy/40"
                )}
              >
                {r.label}
              </button>
            ))}
          </div>

          <p className="section-label mb-1.5 mt-3">Exact dates</p>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              aria-label="From"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              className="h-8 rounded-md border border-input bg-card px-2 text-[12.5px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <input
              type="date"
              aria-label="To"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              className="h-8 rounded-md border border-input bg-card px-2 text-[12.5px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <button
            type="button"
            disabled={!start && !end}
            onClick={() => go({ ...(start ? { from: start } : {}), ...(end ? { to: end } : {}) })}
            className="mt-2 w-full rounded-md bg-navy py-1.5 text-[12.5px] font-semibold text-white transition-colors hover:bg-navy-light disabled:opacity-40"
          >
            Apply dates
          </button>
        </div>
      )}
    </div>
  );
}

function fmt(d: string) {
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
