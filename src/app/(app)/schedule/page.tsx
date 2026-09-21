import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Info, Users } from "lucide-react";
import { listMeetingsBetween } from "@/lib/repo/schedule";
import { calendarStatus, type CalendarStatus } from "@/lib/calendar/status";
import { schedulingConfig } from "@/lib/calendar/config";
import { addDays, formatInZone, zonedParts, zonedToUtc } from "@/lib/calendar/time";
import { WeekGrid, type PlacedMeeting, type WeekDay } from "@/components/schedule/week-grid";
import { cn } from "@/lib/utils";

/**
 * Schedule — the sales side of discovery-call booking.
 *
 * Two things live here. The calls themselves (booked by customers from Talk to
 * Sales, or by a rep from an opportunity), and the honest state of the Google
 * Calendar integration: which rep calendars free/busy is aggregated across,
 * which of them Google refused, and — when it is not configured — exactly which
 * credentials are missing. The availability a customer sees is either real
 * Google free/busy or it is labelled as demo availability; this page never
 * implies the first when it is the second.
 */
export default async function SchedulePage({ searchParams }: PageProps<"/schedule">) {
  const params = await searchParams;
  const cfg = schedulingConfig();
  const tz = cfg.timeZone;
  const now = new Date();

  // The week on screen: Monday-first, in the team's zone, from ?week=YYYY-MM-DD.
  const anchor = typeof params.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(params.week) ? params.week : null;
  const [ay, am, ad] = anchor ? anchor.split("-").map(Number) : (() => { const z = zonedParts(now, tz); return [z.year, z.month, z.day]; })();
  const anchorWeekday = zonedParts(zonedToUtc(ay, am, ad, 12, 0, tz), tz).weekday;
  const monday = addDays(ay, am, ad, -((anchorWeekday + 6) % 7));

  const key = (d: { year: number; month: number; day: number }) => `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  const todayKey = key(zonedParts(now, tz));
  const dayParts = Array.from({ length: 7 }, (_, i) => addDays(monday.year, monday.month, monday.day, i));
  const days: WeekDay[] = dayParts.map((d, i) => ({
    key: key(d),
    label: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][i],
    dayOfMonth: d.day,
    isToday: key(d) === todayKey,
    isWeekend: i >= 5,
  }));

  const weekStart = zonedToUtc(monday.year, monday.month, monday.day, 0, 0, tz);
  const nextMonday = addDays(monday.year, monday.month, monday.day, 7);
  const weekEnd = zonedToUtc(nextMonday.year, nextMonday.month, nextMonday.day, 0, 0, tz);
  const meetings = await listMeetingsBetween(weekStart, weekEnd);
  const status = await calendarStatus();

  // Place each call in its day and minute, in the team's zone. A call that has
  // passed with nothing logged since is the same "overdue" the rest of the app means.
  const placed: PlacedMeeting[] = meetings.map((m) => {
    const at = new Date(m.scheduledFor);
    const z = zonedParts(at, tz);
    return {
      item: m,
      dayKey: key(z),
      startMinute: z.hour * 60 + z.minute,
      durationMinutes: cfg.slotMinutes,
      overdue: at.getTime() < now.getTime() && (!m.lastActivityAt || new Date(m.lastActivityAt).getTime() <= at.getTime()),
    };
  });

  // The grid is the business day. A call booked outside it (a rescheduled
  // evening slot, a demo record from another zone) goes in the strip above
  // rather than stretching the day to 1 AM and leaving a screen of empty rows.
  const startMinute = Math.max(0, Math.floor(cfg.hours.start / 60) * 60);
  const endMinute = Math.min(24 * 60, Math.ceil(cfg.hours.end / 60) * 60);
  const inHours = placed.filter((m) => m.startMinute >= startMinute && m.startMinute < endMinute);
  const outside = placed.filter((m) => !inHours.includes(m));

  const shift = (n: number) => {
    const d = addDays(monday.year, monday.month, monday.day, n);
    return `/schedule?week=${key(d)}`;
  };
  const overdueCount = placed.filter((p) => p.overdue).length;
  const monthLabel = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(monday.year, monday.month - 1, monday.day))
  );

  return (
    <div className="mx-auto max-w-6xl px-6 pb-12 pt-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground">Schedule</h1>
          <p className="mt-1 text-[15px] text-muted-foreground">
            Every discovery call booked across the pipeline, in the week it happens.
          </p>
        </div>
        <IntegrationBadge status={status} />
      </div>

      {/* Week controls */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5">
          <Link href={shift(-7)} aria-label="Previous week" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-card text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <Link href={shift(7)} aria-label="Next week" className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-input bg-card text-muted-foreground transition-colors hover:border-primary/30 hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </Link>
          <Link href="/schedule" className="ml-1 inline-flex h-8 items-center rounded-md border border-input bg-card px-3 text-[13px] font-medium text-foreground transition-colors hover:border-primary/30">
            This week
          </Link>
          <p className="ml-2 text-[15px] font-semibold text-foreground">{monthLabel}</p>
        </div>
        <p className="text-[13px] text-muted-foreground">
          {placed.length === 0 ? "No calls booked this week" : `${placed.length} call${placed.length === 1 ? "" : "s"} this week`}
          {overdueCount > 0 && <span className="text-warning"> · {overdueCount} with nothing logged</span>}
          {outside.length > 0 && ` · ${outside.length} outside ${status.hours}`}
          {" · "}
          {tz}
        </p>
      </div>

      <WeekGrid days={days} meetings={inHours} outside={outside} startMinute={startMinute} endMinute={endMinute} timeZone={tz} now={now} />

      {placed.length === 0 && (
        <p className="mt-3 text-[13px] text-muted-foreground">
          Customers book a slot at the end of Talk to Sales, and reps can schedule one from any opportunity — booked calls appear here in the week they fall.
        </p>
      )}

      {/* The integration's full state, for when the badge is not enough. */}
      <details className="group mt-6">
        <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground">
          <Info className="h-3.5 w-3.5" />
          Calendar integration details
        </summary>
        <div className="mt-3">
          <IntegrationCard status={status} />
        </div>
      </details>
    </div>
  );
}

/** The one-line version: which provider, and whether anything is wrong with it. */
function IntegrationBadge({ status }: { status: CalendarStatus }) {
  const live = status.configured;
  const bad = status.unreadable.length > 0 || Boolean(status.error);
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-[12px] font-medium",
        live && !bad ? "border-success/30 bg-success/5 text-success" : "border-warning/40 bg-warning/5 text-warning"
      )}
    >
      {live && !bad ? <CheckCircle2 className="h-3.5 w-3.5" /> : <AlertTriangle className="h-3.5 w-3.5" />}
      {live
        ? bad
          ? `Google Calendar · ${status.unreadable.length} calendar${status.unreadable.length === 1 ? "" : "s"} not shared`
          : `Live free/busy · ${status.readable.length} calendar${status.readable.length === 1 ? "" : "s"}`
        : "Google Calendar not configured · demo availability"}
    </span>
  );
}

/* ------------------------------------------------------------ integration */

function IntegrationCard({ status }: { status: CalendarStatus }) {
  const live = status.configured;
  return (
    <section
      className={cn(
        "overflow-hidden rounded-[var(--radius)] border bg-card card-shadow",
        live ? "border-success/30" : "border-warning/40"
      )}
    >
      <div className={cn("flex flex-wrap items-start justify-between gap-4 px-5 py-4", live ? "bg-success/5" : "bg-warning/5")}>
        <div className="min-w-0">
          <p className="section-label">Google Calendar integration</p>
          <h2 className={cn("mt-1 flex items-center gap-2 text-[15px] font-semibold", live ? "text-success" : "text-warning")}>
            {live ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {live ? "Connected — availability is real free/busy" : "Not configured — availability is demo data"}
          </h2>
          <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">
            {live
              ? `Slots offered to customers are computed from live free/busy across ${status.readable.length} sales ${status.readable.length === 1 ? "calendar" : "calendars"}. Only busy windows are read — never event titles, attendees or descriptions.`
              : "The customer-facing booking step is showing business-hours availability generated locally, labelled as demo availability wherever it appears. It is not reading anyone's calendar."}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold", live ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
          {status.provider.kind === "google" ? "GOOGLE" : "DEMO"}
        </span>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-border px-5 py-4 sm:grid-cols-4">
        <Field label="Team time zone" value={status.timeZone} />
        <Field label="Business hours" value={`${status.hours} · ${status.bookingDays} business days ahead`} />
        <Field label="Slot length" value={`${status.slotMinutes} minutes · ${status.minNoticeHours}h minimum notice`} />
        <Field label="Offer a slot when" value={`${status.minFreeReps} rep${status.minFreeReps === 1 ? " is" : "s are"} free`} />
        <Field label="Bookable slots now" value={String(status.slotCount)} />
        <Field
          label="Next open slot"
          value={status.nextSlot ? formatInZone(new Date(status.nextSlot), status.timeZone) : "None in the window"}
        />
        <Field label="Invitations" value={status.impersonate ? `Sent as ${status.impersonate}` : "Not enabled — the team sends them manually"} />
        <Field label="Event created on" value={status.bookingCalendar ?? "The assigned rep's calendar"} />
      </dl>

      <div className="border-t border-border px-5 py-4">
        <p className="section-label flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5 text-muted-foreground" /> Sales calendars aggregated ({status.calendars.length})
        </p>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {status.calendars.map((c) => {
            const bad = status.unreadable.includes(c);
            return (
              <li
                key={c}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[12px]",
                  bad ? "border-warning/40 bg-warning/5 text-warning" : "border-border text-muted-foreground"
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", bad ? "bg-warning" : live ? "bg-success" : "bg-border")} />
                {c}
                {bad && <span className="font-medium">not shared</span>}
              </li>
            );
          })}
        </ul>
        {status.unreadable.length > 0 && (
          <p className="mt-2 text-[12px] text-warning">
            Google would not return free/busy for {status.unreadable.length} calendar{status.unreadable.length === 1 ? "" : "s"}. That rep must share their calendar
            with the service account (&ldquo;See only free/busy&rdquo; is enough) — until they do, their time is treated as free.
          </p>
        )}
        {status.error && <p className="mt-2 text-[12px] text-destructive">Free/busy could not be read: {status.error}</p>}
      </div>

      {status.missingConfig.length > 0 && (
        <div className="border-t border-border bg-muted/30 px-5 py-4">
          <p className="section-label flex items-center gap-1.5">
            <Info className="h-3.5 w-3.5 text-muted-foreground" /> {status.configured ? "Not enabled" : "To make this live"}
          </p>
          <ul className="mt-2 space-y-2">
            {status.missingConfig.map((m) => (
              <li key={m.key} className="text-[12px]">
                <code className="rounded bg-card px-1.5 py-0.5 font-mono text-[11px] font-semibold text-foreground">{m.key}</code>
                <span className={cn("ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", m.required ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground")}>
                  {m.required ? "required" : "optional"}
                </span>
                <span className="mt-0.5 block text-muted-foreground">{m.what}</span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12px] text-muted-foreground">
            {status.configured
              ? "Everything else is live. The setup for these optional pieces is in "
              : "Full setup — Google Cloud project, service account, calendar sharing and domain-wide delegation — is in "}
            <code className="font-mono text-[11px]">docs/GOOGLE-CALENDAR.md</code>
            {status.configured ? "." : ". Nothing needs to change in the code: the provider switches from the demo fallback to Google as soon as the credentials are present."}
          </p>
        </div>
      )}
    </section>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="section-label">{label}</dt>
      <dd className="mt-0.5 truncate text-[13px] font-medium text-foreground">{value}</dd>
    </div>
  );
}
