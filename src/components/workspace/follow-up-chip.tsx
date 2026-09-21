import { CalendarClock, AlertTriangle, Check, ExternalLink } from "lucide-react";
import { completeFollowUpAction } from "@/app/actions/followups";
import { formatScheduledTime } from "@/lib/format";
import type { FollowUp } from "@/lib/repo/followups";
import { cn } from "@/lib/utils";
import { isPast } from "@/lib/dashboard";

/**
 * The next booked touchpoint, pinned in the lead header:
 *   "Discovery call · Sat, Sep 26 · 11:00 AM · booked by customer   [Mark done]"
 * Turns amber once the time has passed without being marked done.
 */
export function FollowUpChip({ leadId, followUp }: { leadId: string; followUp: FollowUp | null }) {
  if (!followUp) return null;
  const overdue = isPast(followUp.scheduledFor);
  const Icon = overdue ? AlertTriangle : CalendarClock;

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px]",
        overdue ? "border-warning/40 bg-warning/10 text-foreground" : "border-border bg-muted/50 text-foreground"
      )}
    >
      <Icon className={cn("h-3.5 w-3.5 shrink-0", overdue ? "text-warning" : "text-primary")} />
      <span>
        <span className="font-semibold">{overdue ? `Missed ${followUp.title.toLowerCase()}` : followUp.title}</span>
        <span className="text-muted-foreground"> · {formatScheduledTime(followUp.scheduledFor)}</span>
        {followUp.source === "customer" && <span className="text-muted-foreground"> · booked by customer</span>}
        {followUp.calendar?.rep_name && <span className="text-muted-foreground"> · {followUp.calendar.rep_name}</span>}
        {followUp.calendar?.customer_timezone && (
          <span className="text-muted-foreground" title={`Customer's time zone: ${followUp.calendar.customer_timezone}`}>
            {" "}· {new Intl.DateTimeFormat("en-US", { timeZone: followUp.calendar.customer_timezone, hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(followUp.scheduledFor))} for the customer
          </span>
        )}
      </span>
      {followUp.calendar?.provider === "google" && followUp.calendar.html_link && (
        <a href={followUp.calendar.html_link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-card" title={followUp.calendar.invited ? "Google Calendar event · invitations sent" : "Google Calendar event · send the invitation to the customer"}>
          <ExternalLink className="h-3 w-3" /> Google Calendar
        </a>
      )}
      {followUp.calendar?.provider === "local" && (
        <span className="rounded bg-warning/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning" title="Booked against demo availability — Google Calendar is not configured">
          demo
        </span>
      )}
      <form action={completeFollowUpAction.bind(null, leadId, followUp.activityId)}>
        <button
          type="submit"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-card"
          title="Mark this follow-up as done"
        >
          <Check className="h-3 w-3" /> Mark done
        </button>
      </form>
    </div>
  );
}
