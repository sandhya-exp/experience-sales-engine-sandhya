import { Search, AlertTriangle } from "lucide-react";
import { DOWNSTREAM } from "@/lib/modules";

const STAGE_PILLS: { key: string; label: string }[] = [
  { key: "all", label: "All" },
  { key: "new", label: "New leads" },
  { key: "contacted", label: "Contacted" },
  { key: "qualified", label: "Qualified" },
  { key: "quoted", label: DOWNSTREAM.name },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
  { key: "attention", label: "Needs attention" },
];
import { listLeadRows } from "@/lib/repo/leads";
import { getCurrentUser } from "@/lib/auth";
import Link from "next/link";
import { LEAD_STATUSES } from "@/lib/types";
import type { LeadStatus } from "@/lib/types";
import { needsAttention, inDateRange, parseDateFilter, describeDateFilter } from "@/lib/dashboard";
import { LeadsTable } from "@/components/dashboard/leads-table";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { DateRangeField } from "@/components/dashboard/date-range-field";

export default async function PipelinePage({ searchParams }: PageProps<"/pipeline">) {
  const params = await searchParams;
  const stage = typeof params.stage === "string" ? params.stage : "all";
  const q = typeof params.q === "string" ? params.q.toLowerCase().trim() : "";
  const dateFilter = parseDateFilter(params);
  const range = dateFilter.range;
  const industry = typeof params.industry === "string" ? params.industry : "";
  const owner = typeof params.owner === "string" ? params.owner : ""; // "me" | user id | "unassigned"
  const me = await getCurrentUser();
  const ownerId = owner === "me" ? me?.id ?? "" : owner;
  // Everything except `stage`, so stage links / chips / search can keep the other filters.
  const keep = new URLSearchParams();
  if (range !== "all") keep.set("range", range);
  if (dateFilter.from) keep.set("from", dateFilter.from);
  if (dateFilter.to) keep.set("to", dateFilter.to);
  if (industry) keep.set("industry", industry);
  if (owner) keep.set("owner", owner);
  const withKeep = (base: string, extra?: Record<string, string>) => {
    const p = new URLSearchParams(keep);
    for (const [k, v] of Object.entries(extra ?? {})) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };

  const fetchedRows = await listLeadRows();
  // The date range scopes everything on the page: stage counts, attention, table.
  const allRows = fetchedRows.filter(
    (r) =>
      inDateRange(r, dateFilter) &&
      (!industry || (r.company_industry ?? "Unspecified") === industry) &&
      (!owner || (owner === "unassigned" ? !r.owner_user_id : r.owner_user_id === ownerId))
  );
  const ownerLabel =
    owner === "me" ? "My leads" : owner === "unassigned" ? "Unassigned" : owner ? fetchedRows.find((r) => r.owner_user_id === owner)?.owner_name ?? "Owner" : "";

  const counts = LEAD_STATUSES.reduce(
    (acc, status) => {
      acc[status] = allRows.filter((r) => r.status === status).length;
      return acc;
    },
    {} as Record<LeadStatus, number>,
  );
  const attentionCount = allRows.filter(
    (r) => needsAttention(r).flagged,
  ).length;

  let rows = allRows;
  if (stage === "attention") {
    rows = rows.filter((r) => needsAttention(r).flagged);
  } else if (stage !== "all" && LEAD_STATUSES.includes(stage as LeadStatus)) {
    rows = rows.filter((r) => r.status === stage);
  }
  if (q) {
    rows = rows.filter((r) => r.search_text.includes(q));
  }

  return (
    <div className="mx-auto max-w-7xl px-6 pb-12 pt-8">
      <div className="mb-6">
        <h1 className="mt-1.5 text-[2rem] font-bold leading-tight tracking-tight text-foreground">Sales Pipeline</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">Every open opportunity, and what needs to happen next on each.</p>
      </div>

      {/* Sales Pipeline — the primary workspace */}
      <section className="overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
        <div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {STAGE_PILLS.map((t) => {
              const active = stage === t.key;
              const count = t.key === "all" ? allRows.length : t.key === "attention" ? attentionCount : counts[t.key as LeadStatus];
              return (
                <Link
                  key={t.key}
                  href={withKeep("/pipeline", { stage: t.key === "all" ? "" : t.key })}
                  aria-pressed={active}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
                    active
                      ? t.key === "attention"
                        ? "bg-warning text-white"
                        : "bg-navy text-white"
                      : t.key === "attention"
                        ? "text-warning hover:bg-warning/10"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  {t.key === "attention" && <AlertTriangle className="h-3.5 w-3.5" />}
                  {t.label}
                  <span className={cn("tabular-nums", active ? "text-white/80" : "text-muted-foreground/70")}>{count}</span>
                </Link>
              );
            })}
            {owner && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <span className="font-normal text-muted-foreground/80">Owner</span> <span className="text-foreground">{ownerLabel}</span>
                <Link href={withKeep("/pipeline", { owner: "", ...(stage !== "all" ? { stage } : {}) })} className="hover:text-foreground" aria-label="Clear owner">
                  ×
                </Link>
              </span>
            )}
            {industry && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <span className="font-normal text-muted-foreground/80">Industry</span> <span className="text-foreground">{industry}</span>
                <Link href={withKeep("/pipeline", { industry: "", ...(stage !== "all" ? { stage } : {}) })} className="hover:text-foreground" aria-label="Clear industry">
                  ×
                </Link>
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Start date → End date, inline, the way a range reads elsewhere in
                the product — rather than a dropdown that hides what it applied. */}
            <DateRangeField
              filter={dateFilter}
              basePath="/pipeline"
              keep={{
                ...(stage !== "all" ? { stage } : {}),
                ...(industry ? { industry } : {}),
                ...(owner ? { owner } : {}),
                ...(q ? { q } : {}),
              }}
            />
            <form className="flex items-center gap-2" action="/pipeline" role="search">
              <input type="hidden" name="stage" value={stage} />
              {[...keep.entries()].map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  name="q"
                  defaultValue={q}
                  placeholder="Filter by company or contact"
                  className="h-8 w-full pl-8 text-[13px] sm:w-60"
                />
              </div>
            </form>
          </div>
        </div>
        {(industry || owner || range !== "all" || q) && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-2 text-[12px] text-muted-foreground">
            <span>
              Showing <span className="font-medium text-foreground">{rows.length}</span> of {fetchedRows.length} opportunities
              {" · filtered by "}
              {[industry ? `industry: ${industry}` : "", owner ? `owner: ${ownerLabel}` : "", range !== "all" ? `date: ${describeDateFilter(dateFilter)}` : "", q ? `search: “${q}”` : ""].filter(Boolean).join(", ")}
            </span>
            <Link href={stage !== "all" ? `/pipeline?stage=${stage}` : "/pipeline"} className="font-medium text-primary hover:underline">
              Clear filters
            </Link>
          </div>
        )}
        <LeadsTable rows={rows} />
      </section>

    </div>
  );
}
