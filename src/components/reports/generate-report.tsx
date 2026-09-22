"use client";

import { useState } from "react";
import { FileDown } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { METRIC_RANGES, type MetricRangeKey } from "@/lib/reports/ranges";
import { cn } from "@/lib/utils";

/**
 * Generate report — the option, not a fixed document.
 *
 * A one-click button that always produced the same twelve-month page was the
 * wrong shape: the question a manager actually has is "how did *this period*
 * go", and the period is usually a quarter, a month, or the dates someone else
 * named. So the period is chosen here — a preset or two exact dates — and the
 * scope with it, before anything is produced.
 *
 * What comes out is the print view, which opens the browser's print dialog;
 * "Save as PDF" gives a proper, selectable document. No PDF library, and the
 * report can never disagree with the dashboard because both read the same
 * window through the same metrics layer.
 */
export function GenerateReportDialog({
  range,
  from,
  to,
  canSeeTeam,
}: {
  range: MetricRangeKey;
  from: string | null;
  to: string | null;
  /** Managers and admins can report on the team; an employee's report is their own book. */
  canSeeTeam: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"preset" | "custom">(from || to ? "custom" : "preset");
  const [preset, setPreset] = useState<MetricRangeKey>(range);
  const [start, setStart] = useState(from ?? "");
  const [end, setEnd] = useState(to ?? "");
  const [scope, setScope] = useState<"team" | "mine">(canSeeTeam ? "team" : "mine");

  const href = () => {
    const p = new URLSearchParams();
    if (mode === "custom" && (start || end)) {
      if (start) p.set("from", start);
      if (end) p.set("to", end);
    } else if (preset !== "12m") {
      p.set("range", preset);
    }
    if (scope === "mine") p.set("scope", "mine");
    const qs = p.toString();
    return `/reports/print${qs ? `?${qs}` : ""}`;
  };

  const invalid = mode === "custom" && start && end && start > end;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="h-9 gap-1.5 px-3.5">
          <FileDown className="h-3.5 w-3.5" /> Generate report
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate report</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Period</Label>
            <div className="flex flex-wrap gap-1.5">
              {METRIC_RANGES.map((r) => (
                <button
                  key={r.key}
                  type="button"
                  aria-pressed={mode === "preset" && preset === r.key}
                  onClick={() => {
                    setMode("preset");
                    setPreset(r.key);
                  }}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                    mode === "preset" && preset === r.key ? "border-navy bg-navy text-white" : "border-border bg-card text-foreground hover:border-navy/40"
                  )}
                >
                  {r.label}
                </button>
              ))}
              <button
                type="button"
                aria-pressed={mode === "custom"}
                onClick={() => setMode("custom")}
                className={cn(
                  "rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                  mode === "custom" ? "border-navy bg-navy text-white" : "border-border bg-card text-foreground hover:border-navy/40"
                )}
              >
                Exact dates
              </button>
            </div>

            {mode === "custom" && (
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1">
                  <Label htmlFor="rep-from" className="text-[12px] text-muted-foreground">
                    From
                  </Label>
                  <Input id="rep-from" type="date" value={start} onChange={(e) => setStart(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="rep-to" className="text-[12px] text-muted-foreground">
                    To
                  </Label>
                  <Input id="rep-to" type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
                </div>
              </div>
            )}
            {invalid && <p className="text-[12.5px] text-destructive">The start date is after the end date.</p>}
          </div>

          {canSeeTeam && (
            <div className="space-y-2">
              <Label>Covers</Label>
              <div className="flex gap-1.5">
                {(
                  [
                    { key: "team", label: "Whole team" },
                    { key: "mine", label: "My pipeline only" },
                  ] as const
                ).map((s) => (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={scope === s.key}
                    onClick={() => setScope(s.key)}
                    className={cn(
                      "rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                      scope === s.key ? "border-navy bg-navy text-white" : "border-border bg-card text-foreground hover:border-navy/40"
                    )}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="text-[12px] leading-relaxed text-muted-foreground">
            Opens a one-page report and your browser&rsquo;s print dialog — choose <span className="font-medium text-foreground">Save as PDF</span> to keep it. Every
            figure is read from the opportunities and quotes in this window; nothing is forecast.
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button asChild disabled={Boolean(invalid)}>
              <a href={href()} target="_blank" rel="noreferrer" onClick={() => setOpen(false)}>
                Generate
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
