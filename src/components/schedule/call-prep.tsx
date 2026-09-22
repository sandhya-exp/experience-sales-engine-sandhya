import Link from "next/link";
import { Bot, CalendarClock, CheckCircle2, CircleHelp } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ScheduledItem } from "@/lib/repo/schedule";
import type { AgentActionListRow } from "@/lib/repo/agentActions";

/**
 * AI preparation, beside the calendar.
 *
 * A booked call is not just an entry in a grid — it is the moment the open
 * questions on an opportunity get answered or don't. So each upcoming call is
 * shown with what the agent knows is still unresolved and whether it has
 * written the pre-call brief yet. The agent produces those briefs itself
 * (a `prepare_call` action, banded low-risk because nothing leaves the
 * building); this is where a salesperson sees the result before walking in.
 */
export interface CallPrepRow {
  meeting: ScheduledItem;
  /** The agent's preparation action for this meeting, when it has one. */
  action: AgentActionListRow | null;
  openQuestions: string[];
}

export function CallPreparation({ rows, timeZone }: { rows: CallPrepRow[]; timeZone: string }) {
  if (rows.length === 0) return null;
  return (
    <section className="mt-6 overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3.5">
        <p className="section-label flex items-center gap-1.5">
          <Bot className="h-3.5 w-3.5 text-navy" /> AI preparation
        </p>
        <p className="text-[12px] text-muted-foreground">What the agent knows is still open before each call</p>
      </div>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.meeting.activityId}>
            <Link href={`/leads/${r.meeting.leadId}?tab=brief`} className="block px-5 py-3.5 transition-colors hover:bg-muted/40">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-[14px] font-semibold text-foreground">{r.meeting.companyName}</p>
                <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                  <CalendarClock className="h-3.5 w-3.5" />
                  {new Date(r.meeting.scheduledFor).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone })}
                  {r.meeting.contactName && ` · ${r.meeting.contactName}`}
                </p>
              </div>

              <p className={cn("mt-1 flex items-center gap-1.5 text-[12.5px]", r.action?.meta.state === "executed" ? "text-success" : "text-muted-foreground")}>
                {r.action?.meta.state === "executed" ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" /> Pre-call brief written by the agent
                  </>
                ) : r.action ? (
                  <>
                    <Bot className="h-3.5 w-3.5 text-navy" /> The agent has a brief ready to write — open the opportunity to run it
                  </>
                ) : (
                  <>
                    <Bot className="h-3.5 w-3.5" /> No preparation needed — nothing is outstanding on this opportunity
                  </>
                )}
              </p>

              {r.openQuestions.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {r.openQuestions.slice(0, 3).map((q, i) => (
                    <li key={i} className="flex gap-1.5 text-[12.5px] leading-snug text-foreground">
                      <CircleHelp className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                      {q}
                    </li>
                  ))}
                  {r.openQuestions.length > 3 && <li className="pl-5 text-[12px] text-muted-foreground">+{r.openQuestions.length - 3} more to confirm</li>}
                </ul>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
