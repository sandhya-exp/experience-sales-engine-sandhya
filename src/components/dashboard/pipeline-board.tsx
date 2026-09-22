import Link from "next/link";
import { AlertTriangle, Clock } from "lucide-react";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadListRow, type LeadStatus } from "@/lib/types";
import { needsAttention } from "@/lib/dashboard";
import { formatMoney } from "@/lib/repo/quotes";
import { daysSince } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The pipeline as a board: one column per stage, one card per opportunity.
 *
 * The table answers "show me everything with its details"; this answers "where
 * does the business stand" — a shape you read in a glance rather than a list
 * you scan. Each column carries its count and the value of the quotes in it, so
 * a manager can see that Qualified is full and Ready to Contract is empty
 * without counting rows.
 *
 * Read-only on purpose. Drag-and-drop between columns implies that dropping a
 * card is how a deal advances, and in this product a stage change is a recorded
 * event with a reason and an author — it happens on the opportunity, where the
 * work that justifies it happens.
 */
export function PipelineBoard({ rows, valueByLead, focus }: { rows: LeadListRow[]; valueByLead: Map<string, number>; focus?: LeadStatus | null }) {
  const columns = (focus ? [focus] : LEAD_STATUSES).map((status) => {
    const cards = rows.filter((r) => r.status === status);
    return { status, cards, total: cards.reduce((s, c) => s + (valueByLead.get(c.id) ?? 0), 0) };
  });

  // Filtering to one stage should show that stage, not one populated column
  // beside five empty ones. A single stage is its own view: the cards spread
  // across the width instead of queueing in a 268px lane.
  if (focus) {
    const col = columns[0];
    return (
      <div className="px-4 py-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h3 className="text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{LEAD_STATUS_LABELS[col.status]}</h3>
          <p className="text-[12.5px] tabular-nums text-muted-foreground">
            {col.cards.length} {col.cards.length === 1 ? "opportunity" : "opportunities"}
            {col.total > 0 ? ` · ${formatMoney(col.total)}` : ""}
          </p>
        </div>
        {col.cards.length === 0 ? (
          <p className="rounded-[var(--radius)] border border-dashed border-border py-10 text-center text-[13px] text-muted-foreground">
            Nothing is at {LEAD_STATUS_LABELS[col.status].toLowerCase()} right now.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {col.cards.map((lead) => (
              <BoardCard key={lead.id} lead={lead} value={valueByLead.get(lead.id) ?? 0} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      {/* Columns are bounded and scroll on their own. Won and Lost accumulate
          for as long as the team sells, and one tall column must not stretch
          every other one into a screen of whitespace. */}
      <div className="flex min-w-max items-start gap-3 px-4 py-4">
        {columns.map((col) => (
          <section key={col.status} className="flex max-h-[620px] w-[268px] shrink-0 flex-col rounded-[var(--radius)] border border-border bg-muted/30">
            <header className="border-b border-border px-3 py-2.5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="truncate text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">{LEAD_STATUS_LABELS[col.status]}</h3>
                <span className="text-[13px] font-semibold tabular-nums text-foreground">{col.cards.length}</span>
              </div>
              <p className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">{col.total > 0 ? formatMoney(col.total) : "No quoted value"}</p>
            </header>

            <div className="min-h-[88px] flex-1 space-y-2 overflow-y-auto p-2">
              {col.cards.length === 0 ? (
                <p className="px-1 py-6 text-center text-[12px] text-muted-foreground/70">Nothing here</p>
              ) : (
                col.cards.map((lead) => <BoardCard key={lead.id} lead={lead} value={valueByLead.get(lead.id) ?? 0} />)
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function BoardCard({ lead, value }: { lead: LeadListRow; value: number }) {
  const attention = needsAttention(lead);
  const days = daysSince(lead.last_activity_at ?? lead.created_at);
  const initials = (lead.owner_name ?? "")
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2);

  return (
    <Link
      href={`/leads/${lead.id}`}
      className={cn(
        "block rounded-lg border bg-card px-3 py-2.5 transition-colors hover:border-primary/40 hover:bg-accent/30",
        attention.flagged ? "border-warning/50" : "border-border"
      )}
    >
      <p className="truncate text-[13px] font-semibold text-foreground">{lead.company_name}</p>
      <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
        {lead.primary_contact_name ?? "No contact"}
        {lead.number_of_users ? ` · ${lead.number_of_users} users` : ""}
      </p>

      <p className="mt-1.5 text-[13px] font-semibold tabular-nums text-foreground">{value > 0 ? formatMoney(value) : <span className="font-normal text-muted-foreground">Not quoted</span>}</p>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-border pt-2">
        <span className={cn("inline-flex min-w-0 items-center gap-1 text-[11px]", attention.flagged ? "text-warning" : "text-muted-foreground")}>
          {attention.flagged ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <Clock className="h-3 w-3 shrink-0" />}
          <span className="truncate">{attention.flagged ? attention.reason : days === 0 ? "Active today" : `${days}d since activity`}</span>
        </span>
        {initials && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-primary" title={lead.owner_name ?? undefined}>
            {initials}
          </span>
        )}
      </div>
    </Link>
  );
}

/** Stages, in pipeline order, for anything that needs the same column set. */
export const BOARD_STAGES: LeadStatus[] = LEAD_STATUSES;
