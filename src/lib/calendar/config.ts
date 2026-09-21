/**
 * Discovery-call scheduling configuration. Everything comes from environment
 * variables so the same code runs against real Google Calendar in production
 * and the labelled local fallback in development.
 *
 *   GOOGLE_SERVICE_ACCOUNT_JSON     the service account key file contents (JSON, or base64 of it)
 *     — or —
 *   GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY (PEM; "\n" escapes allowed)
 *   GOOGLE_CALENDAR_IMPERSONATE     optional Workspace user to act as (domain-wide delegation).
 *                                   Required for Google to send invitations to attendees.
 *   SALES_CALENDARS                 comma-separated calendar ids (rep emails). Default: every app_users email.
 *   SALES_BOOKING_CALENDAR          calendar the event is created on. Default: the assigned rep's calendar.
 *   SALES_TIMEZONE                  IANA zone the team works in. Default America/New_York.
 *   SALES_HOURS                     "09:00-17:00" local business hours. Default 09:00-17:00, Mon–Fri.
 *   DISCOVERY_SLOT_MINUTES          slot length. Default 30.
 *   SALES_MIN_FREE_REPS             reps that must be free for a slot to be offered. Default 1.
 *   SALES_BOOKING_DAYS              how many business days ahead to offer. Default 5.
 *   SALES_MIN_NOTICE_HOURS          earliest bookable slot from now. Default 2.
 *   GOOGLE_CALENDAR_API_URL         override for tests (default https://www.googleapis.com).
 */
export interface ServiceAccount {
  clientEmail: string;
  privateKey: string;
}

export function serviceAccountFromEnv(): { account: ServiceAccount | null; reason?: string } {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim();
  if (json) {
    try {
      const raw = json.startsWith("{") ? json : Buffer.from(json, "base64").toString("utf8");
      const parsed = JSON.parse(raw) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) return { account: { clientEmail: parsed.client_email, privateKey: parsed.private_key } };
      return { account: null, reason: "GOOGLE_SERVICE_ACCOUNT_JSON is missing client_email or private_key" };
    } catch {
      return { account: null, reason: "GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON (raw or base64)" };
    }
  }
  const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL?.trim();
  const key = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY?.trim();
  if (email && key) return { account: { clientEmail: email, privateKey: key.replace(/\\n/g, "\n") } };
  return { account: null, reason: "No Google service account configured (GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_EMAIL + GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY)" };
}

export interface SchedulingConfig {
  timeZone: string;
  hours: { start: number; end: number }; // minutes from midnight, local
  slotMinutes: number;
  minFreeReps: number;
  bookingDays: number;
  minNoticeHours: number;
  impersonate: string | null;
  bookingCalendar: string | null;
  /** Explicit rep calendars from env, or null to use the team's emails. */
  calendars: string[] | null;
  apiBase: string;
}

export function schedulingConfig(): SchedulingConfig {
  const hours = (process.env.SALES_HOURS ?? "09:00-17:00").match(/^(\d{1,2}):(\d{2})-(\d{1,2}):(\d{2})$/);
  const toMin = (h: string, m: string) => Number(h) * 60 + Number(m);
  return {
    timeZone: process.env.SALES_TIMEZONE?.trim() || "America/New_York",
    hours: hours ? { start: toMin(hours[1], hours[2]), end: toMin(hours[3], hours[4]) } : { start: 9 * 60, end: 17 * 60 },
    slotMinutes: clampInt(process.env.DISCOVERY_SLOT_MINUTES, 30, 15, 120),
    minFreeReps: clampInt(process.env.SALES_MIN_FREE_REPS, 1, 1, 10),
    bookingDays: clampInt(process.env.SALES_BOOKING_DAYS, 5, 1, 20),
    minNoticeHours: clampInt(process.env.SALES_MIN_NOTICE_HOURS, 2, 0, 72),
    impersonate: process.env.GOOGLE_CALENDAR_IMPERSONATE?.trim() || null,
    bookingCalendar: process.env.SALES_BOOKING_CALENDAR?.trim() || null,
    calendars: process.env.SALES_CALENDARS?.split(",").map((s) => s.trim()).filter(Boolean) ?? null,
    apiBase: (process.env.GOOGLE_CALENDAR_API_URL?.trim() || "https://www.googleapis.com").replace(/\/$/, ""),
  };
}

function clampInt(v: string | undefined, dflt: number, min: number, max: number) {
  const n = Number.parseInt(v ?? "", 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt;
}
