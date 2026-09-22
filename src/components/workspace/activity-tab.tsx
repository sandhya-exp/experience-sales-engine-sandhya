import Link from "next/link";
import { formatActivityTime } from "@/lib/format";
import { Bot, Building2, CalendarClock, Flag, Mail, MessageSquare, Phone, StickyNote, UserRound, Cog } from "lucide-react";
import { ScheduleFollowUpDialog } from "@/components/workspace/schedule-follow-up-dialog";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LogActivityDialog } from "@/components/workspace/log-activity-dialog";
import { buildTimeline, inquiryEvent, type TimelineEvent } from "@/lib/timeline";
import { cn } from "@/lib/utils";
import type { Activity, AiDealBrief } from "@/lib/types";

/**
 * The deal's story, newest first.
 *
 * Every row is a record that already exists — an activity or an AI analysis —
 * given a plain label and an actor: the customer, the team, the AI, the system.
 * Milestones (inquiry, calls, stage moves, handoff, won) are drawn heavier so
 * the shape of the journey is visible before any row is read.
 */
export function ActivityTab({ leadId, activities, briefs, leadCreatedAt, companyName }: { leadId: string; activities: Activity[]; briefs: AiDealBrief[]; quotes?: unknown; leadCreatedAt: string; companyName: string }) {
  const built = buildTimeline(activities, briefs, leadId);
  // The story always starts with the inquiry. If nothing on the record says so
  // explicitly, the lead's own creation does.
  const events = built.some((e) => e.label === "Inquiry received") ? built : [...built, inquiryEvent(leadCreatedAt, companyName)].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const counts = {
    customer: events.filter((e) => e.actor === "customer").length,
    team: events.filter((e) => e.actor === "team").length,
    ai: events.filter((e) => e.actor === "ai").length,
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex flex-wrap items-center gap-x-3 gap-y-1">
          Activity
          <span className="text-[12px] font-normal text-muted-foreground">
            {events.length} events · <span className="text-foreground">{counts.customer}</span> customer · <span className="text-foreground">{counts.team}</span> team · <span className="text-foreground">{counts.ai}</span> AI
          </span>
        </CardTitle>
        <div className="flex flex-wrap gap-2">
          <LogActivityDialog leadId={leadId} defaultType="call" />
          <LogActivityDialog leadId={leadId} defaultType="email" />
          <LogActivityDialog leadId={leadId} defaultType="message" />
          <LogActivityDialog leadId={leadId} defaultType="note" />
          <ScheduleFollowUpDialog leadId={leadId} />
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {events.length === 0 && <p className="text-sm text-muted-foreground">No activity logged yet.</p>}
        <ol className="relative space-y-4 border-l border-border pl-6">
          {events.map((e) => (
            <TimelineRow key={e.id} event={e} />
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

const ACTOR_STYLE: Record<TimelineEvent["actor"], { ring: string; label: string }> = {
  customer: { ring: "bg-warning/15 text-warning", label: "Customer" },
  team: { ring: "bg-accent text-primary", label: "Team" },
  ai: { ring: "bg-navy/10 text-navy", label: "AI" },
  system: { ring: "bg-muted text-muted-foreground", label: "System" },
};

/** The icon is chosen by rule, not by component identity, so the rules engine can't create components during render. */
function EventIcon({ event: e, className }: { event: TimelineEvent; className?: string }) {
  const a = e.activity;
  if (e.milestone && e.label !== "Inquiry received" && !/booked|completed/.test(e.label)) return <Flag className={className} />;
  if (/booked|completed/.test(e.label)) return <CalendarClock className={className} />;
  if (e.actor === "ai") return <Bot className={className} />;
  if (a?.type === "call") return <Phone className={className} />;
  if (a?.type === "email" || /message/i.test(e.label)) return <Mail className={className} />;
  if (a?.type === "message" || /replied/i.test(e.label)) return <MessageSquare className={className} />;
  if (a?.type === "note") return <StickyNote className={className} />;
  if (e.actor === "customer") return <Building2 className={className} />;
  if (e.actor === "team") return <UserRound className={className} />;
  return <Cog className={className} />;
}

function TimelineRow({ event: e }: { event: TimelineEvent }) {
  const style = ACTOR_STYLE[e.actor];
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-3">
        <p className={cn("text-sm text-foreground", e.milestone ? "font-semibold" : "font-medium")}>{e.label}</p>
        <p className="shrink-0 whitespace-nowrap text-xs text-muted-foreground">{formatActivityTime(e.at)}</p>
      </div>
      {e.detail && <p className={cn("text-[13px] leading-snug", e.actor === "customer" ? "italic text-foreground" : "text-foreground")}>{e.detail}</p>}
      <p className="text-[11px] text-muted-foreground">
        <span className={cn("mr-1 rounded px-1 py-px text-[10px] font-semibold uppercase tracking-wide", style.ring)}>{style.label}</span>
        {e.actorName}
      </p>
    </>
  );
  return (
    <li className="relative">
      <span className={cn("absolute -left-[31px] flex items-center justify-center rounded-full", e.milestone ? "h-6 w-6 -translate-x-px ring-2 ring-card" : "h-5 w-5", style.ring)}>
        <EventIcon event={e} className={e.milestone ? "h-3.5 w-3.5" : "h-3 w-3"} />
      </span>
      {e.href ? (
        <Link href={e.href} className="block rounded-md -mx-2 px-2 py-0.5 transition-colors hover:bg-muted/50">
          {body}
        </Link>
      ) : (
        <div className="py-0.5">{body}</div>
      )}
    </li>
  );
}
