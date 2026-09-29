import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { FUNNEL_STAGES, type FunnelLead, type FunnelStage } from "@/lib/repo/funnel";

/**
 * Customer-level evidence for one funnel stage: how long each customer spent
 * (or has spent) in it, what became of them, and — where they stalled or
 * were lost — why. Not a deal list: no owner, no next action, no value.
 * Working the deal is one click away in the Pipeline.
 */
export function FunnelCustomers({ leads, stage, now }: { leads: FunnelLead[]; stage: FunnelStage; now: number }) {
  const idx = FUNNEL_STAGES.findIndex((s) => s.key === stage);
  const next = FUNNEL_STAGES[idx + 1]?.key ?? null;
  const rank = (k: FunnelStage) => FUNNEL_STAGES.findIndex((s) => s.key === k);
  if (leads.length === 0) return <p className="px-6 py-12 text-center text-[13px] text-muted-foreground">No customers reached this stage in this view.</p>;

  const rows = leads.map((l) => {
    const enteredAt = l.entered[stage] ?? new Date(l.created_at).getTime();
    const movedOn = !l.lost && rank(l.furthest) > rank(stage);
    const leftAt = movedOn && next ? l.entered[next] ?? null : l.lost && l.furthest === stage ? l.endedAt : null;
    const stillHere = !movedOn && !l.lost && l.current === stage;
    const days = Math.max(0, Math.round(((leftAt ?? (stillHere ? now : l.endedAt ?? now)) - enteredAt) / 86_400_000));
    const outcome = l.status === "won" && stage === "won"
      ? { label: "Won", variant: "success" as const, order: 3 }
      : movedOn
        ? { label: "Moved on", variant: "navy" as const, order: 3 }
        : l.lost
          ? { label: l.furthest === stage ? "Lost here" : "Lost later", variant: "destructive" as const, order: 1 }
          : { label: "Still here", variant: "warning" as const, order: 0 };
    let reason: string | null = null;
    if (l.lost) reason = l.lostReason ?? "Not recorded";
    else if (stillHere) {
      const quiet = l.lastActivityAt ? Math.floor((now - l.lastActivityAt) / 86_400_000) : null;
      if (l.missedFollowUp) reason = "Missed follow-up";
      else if (quiet !== null && quiet >= 3) reason = `No activity for ${quiet} days`;
      else if (l.qualificationStatus === "not_started" && rank(stage) >= 1 && rank(stage) <= 2) reason = "Qualification not started";
      else reason = "In progress";
    }
    return { l, days, stillHere, outcome, reason };
  });
  rows.sort((a, b) => a.outcome.order - b.outcome.order || b.days - a.days);

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Customer</TableHead>
          <TableHead>Time in stage</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead>Drop-off reason</TableHead>
          <TableHead className="w-40 text-right"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(({ l, days, stillHere, outcome, reason }) => (
          <TableRow key={l.id}>
            <TableCell className="font-semibold text-foreground">{l.company_name}</TableCell>
            <TableCell className="tabular-nums text-muted-foreground">
              {days} day{days === 1 ? "" : "s"}
              {stillHere && <span className="text-muted-foreground/70"> so far</span>}
            </TableCell>
            <TableCell>
              <Badge variant={outcome.variant} className="font-medium">
                {outcome.label}
              </Badge>
            </TableCell>
            <TableCell className={reason && reason !== "In progress" ? "text-foreground" : "text-muted-foreground"}>{reason ?? "—"}</TableCell>
            <TableCell className="py-1 text-right">
              <Link href={`/leads/${l.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
                Open in Pipeline <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
