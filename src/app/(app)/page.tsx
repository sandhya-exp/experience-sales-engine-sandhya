import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { listLeadRows } from "@/lib/repo/leads";
import { LEAD_STATUSES } from "@/lib/types";
import type { LeadStatus } from "@/lib/types";
import { needsAttention, hasUpcomingFollowUp } from "@/lib/dashboard";
import { StatsStrip } from "@/components/dashboard/stats-strip";
import { getCurrentUser } from "@/lib/auth";

/**
 * Home: where the pipeline stands, at a glance. Each stage is a doorway into
 * the Sales Pipeline filtered to it. Everything else (attention, activity,
 * filters) lives in the sidebar and its own pages — nothing is repeated here.
 */
export default async function HomePage() {
  const [rows, user] = await Promise.all([listLeadRows(), getCurrentUser()]);
  const firstName = user?.name.split(" ")[0];
  const booked = rows.filter(hasUpcomingFollowUp).length;
  const mine = rows.filter((r) => r.owner_user_id === user?.id && r.status !== "won" && r.status !== "lost").length;

  const counts = LEAD_STATUSES.reduce(
    (acc, status) => {
      acc[status] = rows.filter((r) => r.status === status).length;
      return acc;
    },
    {} as Record<LeadStatus, number>
  );
  const open = rows.filter((r) => r.status !== "won" && r.status !== "lost").length;
  const attention = rows.filter((r) => needsAttention(r).flagged).length;
  const today = new Date().toDateString();
  const newToday = rows.filter((r) => r.status === "new" && new Date(r.created_at).toDateString() === today).length;

  const summary = [
    `${open} open opportunit${open === 1 ? "y" : "ies"}`,
    newToday > 0 && `${newToday} new inquir${newToday === 1 ? "y" : "ies"} today`,
    attention > 0 && `${attention} need${attention === 1 ? "s" : ""} attention`,
    booked > 0 && `${booked} call${booked === 1 ? "" : "s"} booked`,
    `${mine} owned by you`,
  ].filter(Boolean);

  return (
    <div className="mx-auto max-w-7xl px-6 pb-12 pt-8">
      <div className="mb-8">
        <h1 className="mt-1.5 text-[2rem] font-bold leading-tight tracking-tight text-foreground">
          {firstName ? `Welcome back, ${firstName}` : "Sales Engine"}
        </h1>
        <p className="mt-1 text-[15px] text-muted-foreground">Turn customer inquiries into qualified opportunities.</p>
      </div>

      <div className="mb-3 flex items-baseline justify-between">
        <p className="section-label">Pipeline at a glance</p>
        <Link href="/pipeline" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
          Open Sales Pipeline <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <StatsStrip counts={counts} activeStage="all" />
      <p className="mt-3 text-[13px] text-muted-foreground">{summary.join(" · ")}</p>
    </div>
  );
}
