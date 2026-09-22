import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileText, ShieldAlert } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { canApproveQuotes } from "@/lib/roles";
import { listOpenQuotes, effectiveStatus, formatMoney, type QuoteListRow, type QuoteStatus } from "@/lib/repo/quotes";
import { StatusBadge } from "@/components/workspace/quotes-tab";
import { KpiTile } from "@/components/reports/charts";
import { cn } from "@/lib/utils";

/**
 * Every quote in the workspace, newest first.
 *
 * The opportunity page owns a single deal's versions; this is the view across
 * deals — what is waiting on an approval, what is sitting with a customer, what
 * has expired without an answer. Grouped by the only question that changes what
 * you do next: does this one need *me*, or is it waiting on *them*.
 */
const FILTERS = [
  { key: "open", label: "Live with a customer" },
  { key: "approval", label: "Waiting on approval" },
  { key: "closed", label: "Closed" },
  { key: "all", label: "All" },
] as const;

type FilterKey = (typeof FILTERS)[number]["key"];

function bucketOf(q: QuoteListRow, status: QuoteStatus): FilterKey {
  if (status === "draft" && q.meta.review.needs_approval) return "approval";
  if (status === "sent" || status === "viewed" || status === "approved") return "open";
  if (status === "accepted" || status === "expired" || status === "recalled") return "closed";
  return "open";
}

export default async function QuotesPage({ searchParams }: PageProps<"/quotes">) {
  const params = await searchParams;
  const filter: FilterKey = FILTERS.some((f) => f.key === params.filter) ? (params.filter as FilterKey) : "open";
  const [user, all] = await Promise.all([getCurrentUser(), listOpenQuotes()]);
  const isAdmin = canApproveQuotes(user?.role);

  const decorated = all
    .filter((q) => !q.meta.superseded)
    .map((q) => {
      const status = effectiveStatus(q.meta);
      return { q, status, bucket: bucketOf(q, status) };
    });

  const counts = FILTERS.reduce(
    (acc, f) => ({ ...acc, [f.key]: f.key === "all" ? decorated.length : decorated.filter((d) => d.bucket === f.key).length }),
    {} as Record<FilterKey, number>
  );
  const rows = filter === "all" ? decorated : decorated.filter((d) => d.bucket === filter);

  const liveValue = decorated.filter((d) => d.bucket === "open").reduce((s, d) => s + d.q.meta.total, 0);
  const acceptedValue = decorated.filter((d) => d.status === "accepted").reduce((s, d) => s + d.q.meta.total, 0);

  return (
    <div className="mx-auto max-w-7xl px-6 pb-12 pt-8">
      <div className="mb-6">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground">Quotes</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">Every proposal across the pipeline — what needs an approval, and what is waiting on a customer.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile label="Live with customers" value={formatMoney(liveValue)} sub={`${counts.open} quote${counts.open === 1 ? "" : "s"} out`} />
        <KpiTile label="Waiting on approval" value={String(counts.approval)} sub={isAdmin ? "You can approve these" : "An admin has to approve these"} tone={counts.approval > 0 ? "warning" : "default"} />
        <KpiTile label="Accepted" value={formatMoney(acceptedValue)} sub={`${decorated.filter((d) => d.status === "accepted").length} accepted to date`} tone="success" />
      </div>

      <section className="mt-4 overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-border px-5 py-3.5">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={f.key === "open" ? "/quotes" : `/quotes?filter=${f.key}`}
              aria-pressed={filter === f.key}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
                filter === f.key ? "bg-navy text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {f.key === "approval" && counts.approval > 0 && <ShieldAlert className="h-3.5 w-3.5" />}
              {f.label}
              <span className={cn("tabular-nums", filter === f.key ? "text-white/80" : "text-muted-foreground/70")}>{counts[f.key]}</span>
            </Link>
          ))}
        </div>

        {rows.length === 0 ? (
          <p className="px-5 py-14 text-center text-[13px] text-muted-foreground">
            <FileText className="mx-auto mb-2 h-6 w-6 text-muted-foreground/70" />
            Nothing here right now.
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-5 py-2 text-left font-semibold">Company</th>
                <th className="px-3 py-2 text-left font-semibold">Version</th>
                <th className="px-3 py-2 text-left font-semibold">Status</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                <th className="px-3 py-2 text-right font-semibold">Discount</th>
                <th className="px-3 py-2 text-left font-semibold">Owner</th>
                <th className="px-3 py-2 text-left font-semibold">Valid until</th>
                <th className="px-5 py-2 text-left font-semibold">Check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map(({ q, status }) => (
                <tr key={q.activityId} className="transition-colors hover:bg-muted/40">
                  <td className="px-5 py-2.5">
                    <Link href={`/leads/${q.leadId}?tab=quotes`} className="font-medium text-foreground hover:text-primary hover:underline">
                      {q.companyName}
                    </Link>
                  </td>
                  <td className="px-3 py-2.5 tabular-nums">v{q.meta.version}</td>
                  <td className="px-3 py-2.5">
                    <StatusBadge status={status} />
                  </td>
                  <td className="px-3 py-2.5 text-right font-medium tabular-nums">{formatMoney(q.meta.total)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{q.meta.discount_pct}%</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{q.ownerName ?? "Unassigned"}</td>
                  <td className="px-3 py-2.5 text-muted-foreground">{q.meta.valid_until}</td>
                  <td className="px-5 py-2.5">
                    {q.meta.review.ok ? (
                      <span className="inline-flex items-center gap-1 text-success">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Clear
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-warning">
                        <AlertTriangle className="h-3.5 w-3.5" /> {q.meta.review.needs_approval ? "Needs approval" : `${q.meta.review.issues.length} issue${q.meta.review.issues.length === 1 ? "" : "s"}`}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
