/**
 * Small IANA time-zone helpers built on Intl (no extra dependency). Enough for
 * "9:00 in America/New_York on a given calendar day" → UTC instant, and back.
 */
const dtfCache = new Map<string, Intl.DateTimeFormat>();

function dtf(timeZone: string) {
  let f = dtfCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", weekday: "short" });
    dtfCache.set(timeZone, f);
  }
  return f;
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Wall-clock parts of `date` in `timeZone`. */
export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const p: Record<string, string> = {};
  for (const part of dtf(timeZone).formatToParts(date)) p[part.type] = part.value;
  return {
    year: Number(p.year),
    month: Number(p.month),
    day: Number(p.day),
    hour: Number(p.hour) % 24,
    minute: Number(p.minute),
    second: Number(p.second),
    weekday: WEEKDAYS.indexOf(p.weekday),
  };
}

/** Offset of `timeZone` from UTC at `date`, in minutes (positive east of UTC). */
export function tzOffsetMinutes(date: Date, timeZone: string): number {
  const z = zonedParts(date, timeZone);
  const asUtc = Date.UTC(z.year, z.month - 1, z.day, z.hour, z.minute, z.second);
  return Math.round((asUtc - date.getTime()) / 60_000);
}

/** The UTC instant for a wall-clock time in `timeZone`. Handles DST by re-checking the offset once. */
export function zonedToUtc(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, hour, minute));
  const off1 = tzOffsetMinutes(guess, timeZone);
  const candidate = new Date(guess.getTime() - off1 * 60_000);
  const off2 = tzOffsetMinutes(candidate, timeZone);
  return off1 === off2 ? candidate : new Date(guess.getTime() - off2 * 60_000);
}

/** Add whole calendar days to a (year, month, day) triple. */
export function addDays(year: number, month: number, day: number, n: number) {
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

export function isValidTimeZone(tz: string | null | undefined): tz is string {
  if (!tz) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** "Tue, Sep 22 · 10:00 AM (EDT)" in the given zone. */
export function formatInZone(date: Date, timeZone: string, opts: { withZone?: boolean; withDate?: boolean } = { withZone: true, withDate: true }) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    ...(opts.withDate === false ? {} : { weekday: "short", month: "short", day: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
    ...(opts.withZone === false ? {} : { timeZoneName: "short" }),
  }).format(date);
}

/** Human-readable zone name, e.g. "India Standard Time" → falls back to the IANA id. */
export function zoneDisplayName(timeZone: string) {
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "long" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName");
    return part?.value ?? timeZone;
  } catch {
    return timeZone;
  }
}
