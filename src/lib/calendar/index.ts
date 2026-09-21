import { listTeam } from "@/lib/repo/users";
import { schedulingConfig, serviceAccountFromEnv, type SchedulingConfig } from "@/lib/calendar/config";
import { GoogleCalendarProvider } from "@/lib/calendar/google";
import { LocalAvailabilityProvider } from "@/lib/calendar/local";
import type { BusyInterval, CalendarProvider, ProviderInfo } from "@/lib/calendar/provider";
import { addDays, zonedParts, zonedToUtc } from "@/lib/calendar/time";

export type { CalendarProvider, ProviderInfo } from "@/lib/calendar/provider";

/**
 * Discovery-call scheduling: which calendars count as "the sales team", which
 * provider reads them, and how free/busy becomes the slots a customer can pick.
 */
export interface Slot {
  start: string; // ISO
  end: string; // ISO
  /** Rep calendar ids that are free for this slot (never shown to the customer). */
  freeReps: string[];
}

export interface Availability {
  provider: ProviderInfo;
  timeZone: string; // the sales team's zone
  slotMinutes: number;
  slots: Slot[];
  /** Calendars that could not be read (shared with the sales side, not the customer). */
  unreadable: string[];
  generatedAt: string;
}

/** The rep calendars availability is computed from: SALES_CALENDARS, else every team member's email. */
export async function salesCalendars(cfg = schedulingConfig()): Promise<string[]> {
  if (cfg.calendars?.length) return cfg.calendars;
  const team = await listTeam();
  return team.map((t) => t.email.toLowerCase());
}

export async function getCalendarProvider(cfg = schedulingConfig()): Promise<CalendarProvider> {
  const calendars = await salesCalendars(cfg);
  const { account, reason } = serviceAccountFromEnv();
  if (account) return new GoogleCalendarProvider(account, calendars, { impersonate: cfg.impersonate, apiBase: cfg.apiBase });
  return new LocalAvailabilityProvider(calendars, reason ?? "Google Calendar not configured");
}

/**
 * Bookable slots over the next `bookingDays` business days in the team's zone:
 * business hours, `slotMinutes` long, at least `minFreeReps` reps free, not
 * sooner than `minNoticeHours` from now.
 */
export async function computeAvailability(opts: { now?: Date; cfg?: SchedulingConfig; provider?: CalendarProvider } = {}): Promise<Availability> {
  const cfg = opts.cfg ?? schedulingConfig();
  const now = opts.now ?? new Date();
  const provider = opts.provider ?? (await getCalendarProvider(cfg));
  const calendars = provider.describe().calendars;

  // Window: from now to the end of the last offered business day.
  const days = businessDays(now, cfg, cfg.bookingDays);
  const first = days[0];
  const last = days[days.length - 1];
  const from = zonedToUtc(first.year, first.month, first.day, 0, 0, cfg.timeZone);
  const to = zonedToUtc(last.year, last.month, last.day, 23, 59, cfg.timeZone);

  const busy = calendars.length ? await provider.freeBusy(calendars, from, to) : {};
  const unreadable = calendars.filter((c) => busy[c] === null);
  const readable = calendars.filter((c) => busy[c] !== null && busy[c] !== undefined);

  const earliest = now.getTime() + cfg.minNoticeHours * 3_600_000;
  const slots: Slot[] = [];
  for (const d of days) {
    for (let m = cfg.hours.start; m + cfg.slotMinutes <= cfg.hours.end; m += cfg.slotMinutes) {
      const start = zonedToUtc(d.year, d.month, d.day, Math.floor(m / 60), m % 60, cfg.timeZone);
      const end = new Date(start.getTime() + cfg.slotMinutes * 60_000);
      if (start.getTime() < earliest) continue;
      const freeReps = readable.filter((c) => !overlaps(busy[c] as BusyInterval[], start, end));
      if (freeReps.length >= cfg.minFreeReps) slots.push({ start: start.toISOString(), end: end.toISOString(), freeReps });
    }
  }
  return { provider: provider.describe(), timeZone: cfg.timeZone, slotMinutes: cfg.slotMinutes, slots, unreadable, generatedAt: now.toISOString() };
}

/** Is this exact slot still bookable right now? Returns the free reps or null. */
export async function verifySlot(start: Date, opts: { cfg?: SchedulingConfig; provider?: CalendarProvider } = {}): Promise<Slot | null> {
  const cfg = opts.cfg ?? schedulingConfig();
  const provider = opts.provider ?? (await getCalendarProvider(cfg));
  const calendars = provider.describe().calendars;
  const end = new Date(start.getTime() + cfg.slotMinutes * 60_000);
  // Must be a slot we would offer: business day, on the slot grid, inside hours, enough notice.
  const z = zonedParts(start, cfg.timeZone);
  const minutes = z.hour * 60 + z.minute;
  if (z.weekday === 0 || z.weekday === 6) return null;
  if (minutes < cfg.hours.start || minutes + cfg.slotMinutes > cfg.hours.end || (minutes - cfg.hours.start) % cfg.slotMinutes !== 0) return null;
  if (start.getTime() < Date.now() + cfg.minNoticeHours * 3_600_000) return null;
  const busy = calendars.length ? await provider.freeBusy(calendars, start, end) : {};
  const freeReps = calendars.filter((c) => busy[c] && !overlaps(busy[c] as BusyInterval[], start, end));
  return freeReps.length >= cfg.minFreeReps ? { start: start.toISOString(), end: end.toISOString(), freeReps } : null;
}

function overlaps(busy: BusyInterval[], start: Date, end: Date) {
  return busy.some((b) => b.start < end && b.end > start);
}

function businessDays(now: Date, cfg: SchedulingConfig, count: number) {
  const out: { year: number; month: number; day: number }[] = [];
  let d = zonedParts(now, cfg.timeZone);
  let cur = { year: d.year, month: d.month, day: d.day };
  // Start today (later slots today may still qualify) and walk forward.
  while (out.length < count) {
    const probe = zonedToUtc(cur.year, cur.month, cur.day, 12, 0, cfg.timeZone);
    d = zonedParts(probe, cfg.timeZone);
    if (d.weekday !== 0 && d.weekday !== 6) out.push({ ...cur });
    cur = addDays(cur.year, cur.month, cur.day, 1);
  }
  return out;
}
