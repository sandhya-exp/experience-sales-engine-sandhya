import { AlertTriangle, CalendarCheck, CalendarDays, CheckCircle2, Info, Users } from "lucide-react";
import { listOverdueMeetings, listUpcomingMeetings, type ScheduledItem } from "@/lib/repo/schedule";
import { calendarStatus, type CalendarStatus } from "@/lib/calendar/status";
import { formatInZone } from "@/lib/calendar/time";
import { MeetingRow } from "@/components/dashboard/home-cards";
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
export default async function SchedulePage() {
  const [status, upcoming, overdue] = await Promise.all([calendarStatus(), listUpcomingMeetings(50), listOverdueMeetings(50)]);

  const today = upcoming.filter((m) => new Date(m.scheduledFor).toDateString() === new Date().toDateString());
  const later = upcoming.filter((m) => !today.includes(m));

  return (
    <div className="mx-auto max-w-5xl px-6 pb-12 pt-8">
      <div className="mb-6">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground">Schedule</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Discovery calls across the pipeline, and the calendar the customer-facing booking reads its availability from.
        </p>
      </div>

      <IntegrationCard status={status} />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card
          title={today.length === 0 ? "Nothing booked today" : `Today · ${today.length} call${today.length === 1 ? "" : "s"}`}
          icon={CalendarCheck}
        >
          {today.length === 0 ? <Muted>No discovery calls on the calendar for today.</Muted> : <List items={today} />}
        </Card>

        <Card title={overdue.length === 0 ? "Nothing outstanding" : `Needs a follow-up · ${overdue.length}`} icon={AlertTriangle} tone={overdue.length > 0 ? "warn" : "neutral"}>
          {overdue.length === 0 ? (
            <Muted>Every call that has happened has something logged after it.</Muted>
          ) : (
            <>
              <p className="mb-2 text-[12px] text-muted-foreground">These calls have passed with nothing logged since — log the outcome so the opportunity keeps moving.</p>
              <List items={overdue} />
            </>
          )}
        </Card>
      </div>

      <div className="mt-4">
        <Card title={later.length === 0 ? "Nothing further booked" : `Coming up · ${later.length}`} icon={CalendarDays}>
          {later.length === 0 ? <Muted>Customers can book a slot at the end of Talk to Sales; reps can schedule one from any opportunity.</Muted> : <List items={later} />}
        </Card>
      </div>
    </div>
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
            <Info className="h-3.5 w-3.5 text-muted-foreground" /> To make this live
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
            Full setup — Google Cloud project, service account, calendar sharing and domain-wide delegation — is in{" "}
            <code className="font-mono text-[11px]">docs/GOOGLE-CALENDAR.md</code>. Nothing needs to change in the code: the provider switches from the demo
            fallback to Google as soon as the credentials are present.
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

/* ------------------------------------------------------------------ lists */

function Card({
  title,
  icon: Icon,
  tone = "neutral",
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "neutral" | "warn";
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
      <header className="flex items-center gap-2 border-b border-border px-5 py-3.5">
        <Icon className={cn("h-4 w-4", tone === "warn" ? "text-warning" : "text-muted-foreground")} />
        <h2 className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
      </header>
      <div className="px-5 py-3.5">{children}</div>
    </section>
  );
}

function List({ items }: { items: ScheduledItem[] }) {
  return (
    <ul className="divide-y divide-border">
      {items.map((m) => (
        <MeetingRow key={m.activityId} meeting={m} />
      ))}
    </ul>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-[13px] text-muted-foreground">{children}</p>;
}
