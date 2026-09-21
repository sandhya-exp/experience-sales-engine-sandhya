import { schedulingConfig, serviceAccountFromEnv } from "@/lib/calendar/config";
import { computeAvailability, getCalendarProvider, salesCalendars } from "@/lib/calendar/index";
import type { ProviderInfo } from "@/lib/calendar/provider";

/**
 * Calendar integration state, for the internal Schedule view only.
 *
 * The customer-facing booking step never sees any of this — it gets slot times
 * and a provider label and nothing else (see /api/availability). The sales side
 * needs more: which rep calendars are being aggregated, which of them Google
 * refused, whether the service account can send invitations, and — when it is
 * not configured — exactly which environment variables are missing, so nobody
 * has to guess whether the availability on screen is real.
 */
export interface CalendarStatus {
  provider: ProviderInfo;
  configured: boolean;
  /** Why the fallback is active, when it is. */
  reason: string | null;
  /** Rep calendars availability is aggregated across. */
  calendars: string[];
  /** Calendars Google would not return free/busy for (not shared with the service account, or misspelt). */
  unreadable: string[];
  /** Calendars currently readable. */
  readable: string[];
  timeZone: string;
  hours: string;
  slotMinutes: number;
  minFreeReps: number;
  bookingDays: number;
  minNoticeHours: number;
  /** Workspace user the service account acts as (domain-wide delegation). Required for invitations. */
  impersonate: string | null;
  bookingCalendar: string | null;
  /** Bookable slots right now, across the whole offered window. */
  slotCount: number;
  /** Next bookable slot, ISO. */
  nextSlot: string | null;
  /** Environment variables still needed to make this a live Google integration. */
  missingConfig: { key: string; what: string; required: boolean }[];
  /** Set when free/busy could not be read at all. */
  error: string | null;
}

const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

export async function calendarStatus(): Promise<CalendarStatus> {
  const cfg = schedulingConfig();
  const { account, reason } = serviceAccountFromEnv();
  const calendars = await salesCalendars(cfg);

  const missingConfig: CalendarStatus["missingConfig"] = [];
  if (!account) {
    missingConfig.push({
      key: "GOOGLE_SERVICE_ACCOUNT_JSON",
      what: "The service-account key file for a Google Cloud project with the Calendar API enabled — the whole JSON, or base64 of it. (GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY work instead.)",
      required: true,
    });
  }
  if (!cfg.impersonate) {
    missingConfig.push({
      key: "GOOGLE_CALENDAR_IMPERSONATE",
      what: "A Workspace user the service account acts as, via domain-wide delegation. Without it Google creates the event but refuses to invite attendees, so the customer gets no invitation.",
      required: false,
    });
  }
  if (!cfg.calendars?.length) {
    missingConfig.push({
      key: "SALES_CALENDARS",
      what: `Comma-separated rep calendar ids. Not set, so availability uses the ${calendars.length} team email${calendars.length === 1 ? "" : "s"} in the workspace. Each rep must share their calendar with the service account (free/busy is enough).`,
      required: false,
    });
  }

  let provider: ProviderInfo;
  let unreadable: string[] = [];
  let slotCount = 0;
  let nextSlot: string | null = null;
  let error: string | null = null;
  try {
    const p = await getCalendarProvider(cfg);
    provider = p.describe();
    const availability = await computeAvailability({ cfg, provider: p });
    unreadable = availability.unreadable;
    slotCount = availability.slots.length;
    nextSlot = availability.slots[0]?.start ?? null;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    provider = {
      kind: account ? "google" : "local",
      label: account ? "Google Calendar — free/busy could not be read" : "Demo availability — Google Calendar not configured",
      calendars,
      configured: Boolean(account),
      reason: reason ?? undefined,
    };
  }

  return {
    provider,
    configured: provider.kind === "google" && !error,
    reason: provider.reason ?? reason ?? null,
    calendars,
    unreadable,
    readable: calendars.filter((c) => !unreadable.includes(c)),
    timeZone: cfg.timeZone,
    hours: `${hhmm(cfg.hours.start)}–${hhmm(cfg.hours.end)}`,
    slotMinutes: cfg.slotMinutes,
    minFreeReps: cfg.minFreeReps,
    bookingDays: cfg.bookingDays,
    minNoticeHours: cfg.minNoticeHours,
    impersonate: cfg.impersonate,
    bookingCalendar: cfg.bookingCalendar,
    slotCount,
    nextSlot,
    missingConfig,
    error,
  };
}
