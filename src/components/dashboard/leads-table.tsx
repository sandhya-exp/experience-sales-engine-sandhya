import Link from "next/link";
import { AlertTriangle, ArrowRight, CalendarClock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { formatActivityTime, formatScheduledTime, ACTIVITY_TYPE_LABELS } from "@/lib/format";
import { LEAD_STATUS_LABELS } from "@/lib/types";
import type { LeadListRow } from "@/lib/types";
import { needsAttention, hasUpcomingFollowUp } from "@/lib/dashboard";
import { LeadRow } from "@/components/dashboard/lead-row";

/**
 * The Sales Pipeline: the primary workspace. Each row is one opportunity,
 * read left to right as who → where → what happened → what to do next.
 */
export function LeadsTable({ rows }: { rows: LeadListRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-1 py-16 text-center text-sm text-muted-foreground">
        <p className="font-medium text-foreground">No opportunities match this view</p>
        <p>Try a different stage or clear your search.</p>
      </div>
    );
  }

  return (
    <Table className="min-w-[880px] table-fixed">
      <colgroup>
        <col className="w-[26%]" />
        <col className="w-[7%]" />
        <col className="w-[11%]" />
        <col className="w-[10%]" />
        <col className="w-[16%]" />
        <col />
      </colgroup>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="section-label h-10 px-6">Company</TableHead>
          <TableHead className="section-label h-10 text-right">Users</TableHead>
          <TableHead className="section-label h-10">Stage</TableHead>
          <TableHead className="section-label h-10">Owner</TableHead>
          <TableHead className="section-label h-10">Last activity</TableHead>
          <TableHead className="section-label h-10 pr-6">Next action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((lead) => {
          const attention = needsAttention(lead);
          const href = `/leads/${lead.id}`;
          return (
            <LeadRow key={lead.id} href={href}>
              <TableCell className="px-6 py-3.5 align-top">
                <Link href={href} className="block font-semibold text-foreground group-hover:text-primary">
                  <span className="truncate">{lead.company_name}</span>
                </Link>
                <p className="truncate text-[13px] text-muted-foreground">
                  {lead.primary_contact_name ?? "No contact yet"}
                  {lead.company_industry && <span className="text-muted-foreground/70"> · {lead.company_industry}</span>}
                </p>
                {attention.flagged ? (
                  <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-warning">
                    <AlertTriangle className="h-3 w-3 shrink-0" /> {attention.reason}
                  </span>
                ) : (
                  hasUpcomingFollowUp(lead) && lead.follow_up_at && (
                    <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-primary">
                      <CalendarClock className="h-3 w-3 shrink-0" /> {lead.follow_up_title ?? "Follow-up"} ·{" "}
                      {formatScheduledTime(lead.follow_up_at)}
                    </span>
                  )
                )}
              </TableCell>
              <TableCell className="py-3.5 text-right align-top tabular-nums text-muted-foreground">
                {lead.number_of_users ?? "—"}
              </TableCell>
              <TableCell className="py-3.5 align-top">
                <StageBadge status={lead.status} />
              </TableCell>
              <TableCell className="truncate py-3.5 align-top text-[13px] text-muted-foreground">
                {lead.owner_name ?? "Unassigned"}
              </TableCell>
              <TableCell className="py-3.5 align-top">
                {lead.last_activity_at && lead.last_activity_type ? (
                  <div className="leading-tight">
                    <p className="text-[13px] font-medium text-foreground">{ACTIVITY_TYPE_LABELS[lead.last_activity_type]}</p>
                    <p className="whitespace-nowrap text-xs text-muted-foreground">{formatActivityTime(lead.last_activity_at)}</p>
                  </div>
                ) : (
                  <span className="text-[13px] text-muted-foreground">No activity</span>
                )}
              </TableCell>
              <TableCell className="py-3.5 pr-6 align-top">
                {lead.next_action ? (
                  <span className="flex items-start gap-2 text-sm font-medium text-foreground">
                    <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                    <span className="line-clamp-2">{lead.next_action}</span>
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </TableCell>
            </LeadRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

export function StageBadge({ status }: { status: LeadListRow["status"] }) {
  const variant =
    status === "won" ? "success" : status === "lost" ? "destructive" : status === "qualified" ? "navy" : "default";
  const label = status === "new" ? "New" : LEAD_STATUS_LABELS[status];
  return <Badge variant={variant}>{label}</Badge>;
}
