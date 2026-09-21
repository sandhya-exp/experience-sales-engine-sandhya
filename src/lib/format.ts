import { format, isToday, isTomorrow, isYesterday } from "date-fns";
import type { ActivityType } from "@/lib/types";

/**
 * The one way activity timestamps are shown across the app:
 *   "Today · 4:32 PM", "Yesterday · 11:08 AM", otherwise "Sep 15, 2026 · 3:20 PM".
 * Relative words only where they are unambiguous; older entries get the full date.
 */
export function formatActivityTime(iso: string | Date): string {
  const d = new Date(iso);
  const time = format(d, "h:mm a");
  if (isToday(d)) return `Today · ${time}`;
  if (isYesterday(d)) return `Yesterday · ${time}`;
  return `${format(d, "MMM d, yyyy")} · ${time}`;
}

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  call: "Call",
  email: "Email",
  message: "Message",
  note: "Note",
  status_change: "Stage change",
  qualification_change: "Qualification",
};

/**
 * A scheduled time, as a rep reads it off a calendar:
 *   "Today · 11:00 AM", "Tomorrow · 2:00 PM", otherwise "Sat, Sep 26 · 11:00 AM".
 */
export function formatScheduledTime(iso: string | Date): string {
  const d = new Date(iso);
  const time = format(d, "h:mm a");
  if (isToday(d)) return `Today · ${time}`;
  if (isTomorrow(d)) return `Tomorrow · ${time}`;
  return `${format(d, "EEE, MMM d")} · ${time}`;
}

/** Timeline label for one activity — a booked follow-up reads "Call booked", not "Call". */
export function activityLabel(type: ActivityType, metadata?: Record<string, unknown> | null): string {
  if (metadata?.kind === "follow_up") return metadata.completed ? "Call completed" : "Call booked";
  return ACTIVITY_TYPE_LABELS[type];
}
