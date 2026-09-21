import { formatActivityTime, activityLabel } from "@/lib/format";
import { Phone, Mail, MessageSquare, StickyNote, RefreshCcw, CalendarClock } from "lucide-react";
import { ScheduleFollowUpDialog } from "@/components/workspace/schedule-follow-up-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogActivityDialog } from "@/components/workspace/log-activity-dialog";
import type { Activity } from "@/lib/types";

const ICON = {
  call: Phone,
  email: Mail,
  message: MessageSquare,
  note: StickyNote,
  status_change: RefreshCcw,
  qualification_change: RefreshCcw,
};

export function ActivityTab({ leadId, activities }: { leadId: string; activities: Activity[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle>Activity</CardTitle>
        <div className="flex gap-2">
          <LogActivityDialog leadId={leadId} defaultType="call" />
          <LogActivityDialog leadId={leadId} defaultType="email" />
          <LogActivityDialog leadId={leadId} defaultType="message" />
          <LogActivityDialog leadId={leadId} defaultType="note" />
          <ScheduleFollowUpDialog leadId={leadId} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {activities.length === 0 && <p className="text-sm text-muted-foreground">No activity logged yet.</p>}
        <ol className="relative space-y-5 border-l border-border pl-5">
          {activities.map((activity) => {
            const Icon = activity.metadata?.kind === "follow_up" ? CalendarClock : ICON[activity.type];
            return (
              <li key={activity.id} className="relative">
                <span className="absolute -left-[27px] flex h-5 w-5 items-center justify-center rounded-full bg-accent text-primary">
                  <Icon className="h-3 w-3" />
                </span>
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-foreground">{activityLabel(activity.type, activity.metadata)}</p>
                  <p className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{formatActivityTime(activity.occurred_at)}</p>
                </div>
                {activity.body && <p className="text-sm text-foreground">{activity.body}</p>}
                <p className="text-xs text-muted-foreground">{activity.actor_name ?? "System"}</p>
              </li>
            );
          })}
        </ol>
      </CardContent>
    </Card>
  );
}
