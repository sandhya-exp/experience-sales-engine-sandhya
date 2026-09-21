import { query } from "@/lib/db";
import { FOLLOW_UP_KIND, type FollowUpCalendar } from "@/lib/repo/followups";

/**
 * Scheduled discovery calls and follow-ups across the whole pipeline.
 *
 * There is no meetings table and there isn't going to be one: a booked call is
 * already an `activity` with `metadata.kind = 'follow_up'` (see
 * lib/repo/followups.ts). These queries read that same record across every
 * opportunity so the Schedule view and the Home dashboard can answer "what is
 * coming up" and "what did we miss" without duplicating the model.
 */
export interface ScheduledItem {
  activityId: string;
  leadId: string;
  companyId: string;
  companyName: string;
  companyIndustry: string | null;
  contactName: string | null;
  contactEmail: string | null;
  ownerName: string | null;
  leadStatus: string;
  scheduledFor: string;
  title: string;
  source: "customer" | "rep";
  calendar: FollowUpCalendar | null;
  /** Latest activity on the opportunity, to tell "done" from "missed". */
  lastActivityAt: string | null;
}

interface Row {
  id: string;
  lead_id: string;
  company_id: string;
  company_name: string;
  company_industry: string | null;
  contact_name: string | null;
  contact_email: string | null;
  owner_name: string | null;
  lead_status: string;
  metadata: Record<string, unknown>;
  last_activity_at: string | null;
}

const BASE = `
  select a.id, a.lead_id, a.metadata,
         l.company_id, l.status as lead_status,
         c.name as company_name, c.industry as company_industry,
         ct.name as contact_name, ct.email as contact_email,
         u.name as owner_name,
         (select max(x.occurred_at) from activities x where x.lead_id = l.id) as last_activity_at
  from activities a
  join leads l on l.id = a.lead_id
  join companies c on c.id = l.company_id
  left join contacts ct on ct.id = l.primary_contact_id
  left join app_users u on u.id = l.owner_user_id
  where a.metadata->>'kind' = $1
    and coalesce((a.metadata->>'completed')::boolean, false) = false
    and l.status not in ('won','lost')
`;

function toItem(r: Row): ScheduledItem {
  return {
    activityId: r.id,
    leadId: r.lead_id,
    companyId: r.company_id,
    companyName: r.company_name,
    companyIndustry: r.company_industry,
    contactName: r.contact_name,
    contactEmail: r.contact_email,
    ownerName: r.owner_name,
    leadStatus: r.lead_status,
    scheduledFor: String(r.metadata.scheduled_for),
    title: String(r.metadata.title ?? "Follow-up"),
    source: (r.metadata.source as "customer" | "rep") ?? "rep",
    calendar: (r.metadata.calendar as FollowUpCalendar | undefined) ?? null,
    lastActivityAt: r.last_activity_at,
  };
}

/** Booked calls still ahead of us, soonest first. */
export async function listUpcomingMeetings(limit = 50): Promise<ScheduledItem[]> {
  const rows = await query<Row>(
    `${BASE} and (a.metadata->>'scheduled_for')::timestamptz >= now()
     order by (a.metadata->>'scheduled_for')::timestamptz asc limit $2`,
    [FOLLOW_UP_KIND, limit]
  );
  return rows.map(toItem);
}

/**
 * Booked calls whose time has passed with nothing logged since — the same rule
 * `needsAttention` uses, so the dashboard and the pipeline agree.
 */
export async function listOverdueMeetings(limit = 50): Promise<ScheduledItem[]> {
  const rows = await query<Row>(
    `${BASE} and (a.metadata->>'scheduled_for')::timestamptz < now()
     order by (a.metadata->>'scheduled_for')::timestamptz desc limit $2`,
    [FOLLOW_UP_KIND, limit]
  );
  return rows
    .map(toItem)
    .filter((m) => !m.lastActivityAt || new Date(m.lastActivityAt).getTime() <= new Date(m.scheduledFor).getTime());
}

/**
 * Every booked call inside a window, for the week grid. Same record as the
 * lists above — a follow-up activity — read by time range instead of by
 * "ahead of now" / "behind now", because a week view has to show both.
 */
export async function listMeetingsBetween(from: Date, to: Date): Promise<ScheduledItem[]> {
  const rows = await query<Row>(
    `${BASE} and (a.metadata->>'scheduled_for')::timestamptz >= $2
       and (a.metadata->>'scheduled_for')::timestamptz < $3
     order by (a.metadata->>'scheduled_for')::timestamptz asc`,
    [FOLLOW_UP_KIND, from.toISOString(), to.toISOString()]
  );
  return rows.map(toItem);
}
