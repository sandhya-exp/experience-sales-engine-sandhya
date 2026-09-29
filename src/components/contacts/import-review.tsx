"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, Copy, RefreshCw, SkipForward } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import type { ImportPlan, PlannedRow, RowStatus } from "@/app/actions/contacts";

/**
 * The review step shared by CSV and external imports: what will happen to
 * every row, in numbers first and then row by row, with the user in control
 * of what gets written. The plan came from the server; the user's include
 * choices go back with it.
 */
const STATUS: Record<RowStatus, { label: string; variant: "success" | "navy" | "outline" | "warning" | "destructive"; Icon: React.ComponentType<{ className?: string }> }> = {
  create: { label: "New", variant: "success", Icon: CheckCircle2 },
  update: { label: "Update", variant: "navy", Icon: RefreshCw },
  skip: { label: "Already on file", variant: "outline", Icon: SkipForward },
  duplicate_in_file: { label: "Duplicate in file", variant: "warning", Icon: Copy },
  invalid: { label: "Needs attention", variant: "destructive", Icon: AlertTriangle },
};

type Filter = "all" | "create" | "update" | "attention" | "duplicates";

export function ImportReview({ plan, onChange }: { plan: ImportPlan; onChange: (rows: PlannedRow[]) => void }) {
  const [filter, setFilter] = useState<Filter>("all");
  const rows = plan.rows;
  const s = plan.summary;

  const visible = useMemo(() => {
    switch (filter) {
      case "create":
        return rows.filter((r) => r.status === "create");
      case "update":
        return rows.filter((r) => r.status === "update" || r.status === "skip");
      case "attention":
        return rows.filter((r) => r.status === "invalid" || (r.status === "create" && r.warnings.length > 0));
      case "duplicates":
        return rows.filter((r) => r.status === "duplicate_in_file" || r.status === "update" || r.status === "skip");
      default:
        return rows;
    }
  }, [rows, filter]);

  const toggle = (line: number, include: boolean) => onChange(rows.map((r) => (r.line === line ? { ...r, include } : r)));
  const willWrite = rows.filter((r) => r.include && (r.status === "create" || r.status === "update"));

  const tiles: { key: Filter; n: number; label: string; tone: string }[] = [
    { key: "create", n: s.ready, label: `contact${s.ready === 1 ? "" : "s"} ready to import`, tone: "text-success" },
    { key: "attention", n: s.attention, label: "need attention", tone: s.attention ? "text-destructive" : "text-muted-foreground" },
    { key: "duplicates", n: s.duplicates, label: "possible duplicates", tone: s.duplicates ? "text-warning" : "text-muted-foreground" },
    { key: "update", n: s.updates, label: `existing contact${s.updates === 1 ? "" : "s"} to update · ${s.skips} unchanged`, tone: "text-navy" },
  ];

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setFilter(filter === t.key ? "all" : t.key)}
            className={cn("rounded-lg border px-3 py-2 text-left transition-colors hover:bg-muted/40", filter === t.key ? "border-navy/40 bg-[#eef2fb]" : "border-border bg-card")}
          >
            <p className={cn("text-[20px] font-semibold tabular-nums leading-none", t.tone)}>{t.n}</p>
            <p className="mt-1 text-[11.5px] leading-snug text-muted-foreground">{t.label}</p>
          </button>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Building2 className="h-3.5 w-3.5" /> {s.newCompanies} new compan{s.newCompanies === 1 ? "y" : "ies"} will be created; the rest match an account already on file by email domain or name.
        </span>
        {s.ownersUnmatched > 0 && <span>· {s.ownersUnmatched} owner name{s.ownersUnmatched === 1 ? "" : "s"} did not match a team member (ignored).</span>}
        {filter !== "all" && (
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setFilter("all")}>
            Show all {rows.length}
          </Button>
        )}
      </p>

      <div className="max-h-[340px] overflow-auto rounded-lg border border-border">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="w-8 px-2 py-1.5"></th>
              <th className="px-2 py-1.5 text-left">Contact</th>
              <th className="px-2 py-1.5 text-left">Company</th>
              <th className="px-2 py-1.5 text-left">Result</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => {
              const st = STATUS[r.status];
              const selectable = r.status === "create" || r.status === "update";
              return (
                <tr key={r.line} className={cn("border-t border-border align-top", !r.include && selectable && "opacity-60")}>
                  <td className="px-2 py-1.5">
                    {selectable ? <Checkbox checked={r.include} onCheckedChange={(v) => toggle(r.line, Boolean(v))} aria-label={`Include line ${r.line}`} /> : null}
                  </td>
                  <td className="px-2 py-1.5">
                    <p className="font-medium text-foreground">{r.name || <span className="text-muted-foreground">—</span>}</p>
                    <p className="text-muted-foreground">{r.email || "no email"}</p>
                    {(r.title || r.phone) && <p className="text-[11.5px] text-muted-foreground">{[r.title, r.phone].filter(Boolean).join(" · ")}</p>}
                  </td>
                  <td className="px-2 py-1.5">
                    <p className="text-foreground">{r.company ?? <span className="text-muted-foreground">—</span>}</p>
                    {r.companyAction === "create" && <p className="text-[11px] text-warning">New company</p>}
                    {r.companyAction === "existing" && r.companyMatch && <p className="text-[11px] text-muted-foreground">Matched by {r.companyMatch}</p>}
                  </td>
                  <td className="px-2 py-1.5">
                    <Badge variant={st.variant} className="font-medium">
                      <st.Icon className="mr-1 h-3 w-3" /> {st.label}
                    </Badge>
                    {r.status === "update" && r.existing && <p className="mt-1 text-[11.5px] text-muted-foreground">Updates {r.changes?.join(", ")} on {r.existing.name} ({r.existing.company_name})</p>}
                    {r.status === "skip" && r.existing && <p className="mt-1 text-[11.5px] text-muted-foreground">Identical to {r.existing.name} ({r.existing.company_name})</p>}
                    {r.status === "duplicate_in_file" && <p className="mt-1 text-[11.5px] text-muted-foreground">Same email as line {r.duplicateOf}</p>}
                    {r.errors.map((e) => (
                      <p key={e} className="mt-1 text-[11.5px] text-destructive">
                        {e}
                      </p>
                    ))}
                    {r.warnings.map((w) => (
                      <p key={w} className="mt-1 text-[11.5px] text-warning">
                        {w}
                      </p>
                    ))}
                    <p className="mt-0.5 text-[10.5px] text-muted-foreground/70">Line {r.line}</p>
                  </td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                  Nothing in this group.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-[12px] text-muted-foreground">
        <span className="font-medium text-foreground">{willWrite.length}</span> row{willWrite.length === 1 ? "" : "s"} will be written. Rows marked “needs attention” or “duplicate in file” are never imported; fix the file and upload again to include them.
      </p>
    </div>
  );
}
