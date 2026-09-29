import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { LEAD_STATUS_LABELS } from "@/lib/types";
import { FUNNEL_STAGES, type FunnelLead, type FunnelStage } from "@/lib/repo/funnel";
import { cn } from "@/lib/utils";

/**
 * The customers behind a funnel number — deliberately lighter than the
 * Pipeline table. Who they are, where they are, how long they have been on
 * the journey, and what became of them relative to the stage that was
 * clicked. Working the deal happens in the Pipeline, one click away.
 */
export function FunnelCustomers({ leads, stage, now }: { leads: FunnelLead[]; stage: FunnelStage; now: number }) {
  const rank = (k: FunnelStage) => FUNNEL_STAGES.findIndex((s) => s.key === k);
  if (leads.length === 0) {
    return <p className="px-6 py-12 text-center text-[13px] text-muted-foreground">No customers in this group.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Company</TableHead>
          <TableHead>Contact</TableHead>
          <TableHead>Current stage</TableHead>
          <TableHead>Time in journey</TableHead>
          <TableHead>Outcome</TableHead>
          <TableHead className="w-40 text-right"></TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {leads.map((l) => {
          const started = new Date(l.created_at).getTime();
          const days = Math.max(0, Math.round(((l.endedAt ?? now) - started) / 86_400_000));
          const outcome = l.status === "won"
            ? { label: "Won", variant: "success" as const }
            : l.lost
              ? { label: l.furthest === stage ? "Lost here" : "Lost later", variant: "destructive" as const }
              : rank(l.furthest) > rank(stage)
                ? { label: "Moved on", variant: "navy" as const }
                : { label: "Here now", variant: "outline" as const };
          return (
            <TableRow key={l.id}>
              <TableCell className="font-semibold text-foreground">{l.company_name}</TableCell>
              <TableCell className="text-muted-foreground">{l.contact_name ?? "—"}</TableCell>
              <TableCell className="text-foreground">{LEAD_STATUS_LABELS[l.status]}</TableCell>
              <TableCell className="tabular-nums text-muted-foreground">
                {days} day{days === 1 ? "" : "s"}
                <span className="text-muted-foreground/70">{l.endedAt ? "" : " so far"}</span>
              </TableCell>
              <TableCell>
                <Badge variant={outcome.variant} className={cn("font-medium")}>
                  {outcome.label}
                </Badge>
              </TableCell>
              <TableCell className="py-1 text-right">
                <Link href={`/leads/${l.id}`} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
                  Open in Pipeline <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
