import type { LeadListRow } from "@/lib/types";

const ATTENTION_STALE_DAYS = 3;

export function needsAttention(lead: LeadListRow): { flagged: boolean; reason?: string } {
  if (lead.status === "won" || lead.status === "lost") return { flagged: false };

  // A booked call whose time has passed with nothing logged since is the most
  // urgent kind of stall — surface it before anything else.
  if (lead.follow_up_at) {
    const due = new Date(lead.follow_up_at).getTime();
    const lastTouch = lead.last_activity_at ? new Date(lead.last_activity_at).getTime() : 0;
    if (due < Date.now() && lastTouch <= due) {
      return { flagged: true, reason: `Missed ${lead.follow_up_title ?? "follow-up"}` };
    }
  }

  if (lead.qualification_status === "not_started" && lead.status !== "new") {
    return { flagged: true, reason: "Qualification incomplete" };
  }

  const reference = lead.last_activity_at ?? lead.created_at;
  const daysSince = (Date.now() - new Date(reference).getTime()) / (1000 * 60 * 60 * 24);
  if (daysSince >= ATTENTION_STALE_DAYS) {
    return { flagged: true, reason: `No activity for ${Math.floor(daysSince)} days` };
  }
  return { flagged: false };
}

/* ---------------------------------------------------------------- */
/* Date range filter for the pipeline                                */
/* ---------------------------------------------------------------- */

export const DATE_RANGES = ["all", "today", "7d", "30d", "90d", "custom"] as const;
export type DateRange = (typeof DATE_RANGES)[number];

export const DATE_RANGE_LABELS: Record<DateRange, string> = {
  all: "All time",
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  custom: "Custom range",
};

export interface DateFilter {
  range: DateRange;
  /** ISO dates (YYYY-MM-DD) for range === "custom" */
  from: string | null;
  to: string | null;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateFilter(params: Record<string, string | string[] | undefined>): DateFilter {
  const r = typeof params.range === "string" && (DATE_RANGES as readonly string[]).includes(params.range) ? (params.range as DateRange) : "all";
  const from = typeof params.from === "string" && ISO_DAY.test(params.from) ? params.from : null;
  const to = typeof params.to === "string" && ISO_DAY.test(params.to) ? params.to : null;
  if (r === "custom" && !from && !to) return { range: "all", from: null, to: null };
  return { range: r, from: r === "custom" ? from : null, to: r === "custom" ? to : null };
}

/** Backwards-compatible helper used by the sidebar. */
export function parseDateRange(v: unknown): DateRange {
  return typeof v === "string" && (DATE_RANGES as readonly string[]).includes(v) ? (v as DateRange) : "all";
}

export function describeDateFilter(f: DateFilter): string {
  if (f.range !== "custom") return DATE_RANGE_LABELS[f.range];
  const fmt = (d: string) => new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (f.from && f.to) return `${fmt(f.from)} – ${fmt(f.to)}`;
  if (f.from) return `From ${fmt(f.from)}`;
  return `Until ${fmt(f.to as string)}`;
}

/**
 * A lead is "in range" when it was created or last worked within the window —
 * the question a rep is asking is "what's been moving lately", not "what was
 * created lately", so activity counts as much as creation does.
 */
export function inDateRange(lead: LeadListRow, f: DateFilter | DateRange, now = new Date()): boolean {
  const filter: DateFilter = typeof f === "string" ? { range: f, from: null, to: null } : f;
  if (filter.range === "all") return true;

  let start: Date | null = null;
  let end: Date | null = null;
  if (filter.range === "custom") {
    if (filter.from) start = new Date(filter.from + "T00:00:00");
    if (filter.to) {
      end = new Date(filter.to + "T00:00:00");
      end.setDate(end.getDate() + 1); // inclusive of the "to" day
    }
  } else {
    start = new Date(now);
    if (filter.range === "today") start.setHours(0, 0, 0, 0);
    else start.setDate(start.getDate() - (filter.range === "7d" ? 7 : filter.range === "30d" ? 30 : 90));
  }

  const touched = new Date(lead.last_activity_at ?? lead.created_at);
  const created = new Date(lead.created_at);
  const within = (d: Date) => (!start || d >= start) && (!end || d < end);
  return within(touched) || within(created);
}

/** A booked follow-up that hasn't happened yet (won/lost deals don't count). */
export function hasUpcomingFollowUp(lead: LeadListRow): boolean {
  if (!lead.follow_up_at || lead.status === "won" || lead.status === "lost") return false;
  return new Date(lead.follow_up_at).getTime() > Date.now();
}

export function isPast(iso: string | Date): boolean {
  return new Date(iso).getTime() < Date.now();
}
