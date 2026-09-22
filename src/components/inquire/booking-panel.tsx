"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarX2, ChevronLeft, ChevronRight, Clock, Globe, Loader2, Sparkles } from "lucide-react";
import { bookCustomerSlotAction } from "@/app/actions/followups";
import { MEETING_DURATIONS, type MeetingDuration, type MeetingRecommendation } from "@/lib/calendar/recommend";
import { cn } from "@/lib/utils";

interface AvailabilityResponse {
  provider: { kind: "google" | "local"; label: string; configured: boolean };
  timeZone: string;
  slotMinutes: number;
  slots: { start: string; end: string }[];
}

/**
 * Choosing a time for the discovery call.
 *
 * A month calendar on one side and the open times for the chosen day on the
 * other — the shape people already know from every scheduling tool, so nobody
 * has to learn it. Two things are different, and both come from the agent
 * having already read the inquiry: the length is chosen for this conversation
 * rather than fixed at thirty minutes for everyone, and the panel beside it
 * says what the call will cover.
 *
 * Availability is always the server's answer. Changing the length re-asks for
 * it, because a sixty-minute call is only bookable where the team is free for a
 * whole hour, and the booking re-verifies the slot again before it is taken —
 * the browser's list is a display, never the authority.
 */
export function BookingPanel({ leadId, recommendation, error }: { leadId: string; recommendation: MeetingRecommendation; error?: string | null }) {
  const [minutes, setMinutes] = useState<MeetingDuration>(recommendation.minutes);
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  // Which length the data on screen is for. Comparing it to the chosen length
  // *derives* the loading state, rather than flipping a flag from inside the
  // effect body — the same answer, without a synchronous setState in render.
  const [loadedFor, setLoadedFor] = useState<MeetingDuration | null>(null);
  const [failed, setFailed] = useState(false);
  const loading = loadedFor !== minutes && !failed;
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [monthOffset, setMonthOffset] = useState(0);

  const tz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/availability?minutes=${minutes}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: AvailabilityResponse) => {
        if (cancelled) return;
        setData(d);
        setFailed(false);
        setLoadedFor(minutes);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        setLoadedFor(minutes);
      });
    return () => {
      cancelled = true;
    };
  }, [minutes]);

  /* Slots grouped by the customer's own calendar day. */
  const byDay = useMemo(() => {
    const map = new Map<string, { start: string; time: string }[]>();
    if (!data) return map;
    const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
    const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    for (const s of data.slots) {
      const d = new Date(s.start);
      const key = keyFmt.format(d);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ start: s.start, time: timeFmt.format(d) });
    }
    return map;
  }, [data, tz]);

  const openDays = useMemo(() => [...byDay.keys()].sort(), [byDay]);
  const activeDay = selectedDay && byDay.has(selectedDay) ? selectedDay : openDays[0] ?? null;
  const slots = activeDay ? byDay.get(activeDay) ?? [] : [];

  /* The month grid. Starts on the month holding the first open day. */
  const monthBase = useMemo(() => {
    const anchor = openDays[0] ? new Date(`${openDays[0]}T12:00:00`) : new Date();
    return new Date(anchor.getFullYear(), anchor.getMonth() + monthOffset, 1);
  }, [openDays, monthOffset]);

  const grid = useMemo(() => {
    const first = new Date(monthBase.getFullYear(), monthBase.getMonth(), 1);
    const daysInMonth = new Date(monthBase.getFullYear(), monthBase.getMonth() + 1, 0).getDate();
    const cells: { key: string | null; day: number | null }[] = [];
    for (let i = 0; i < first.getDay(); i++) cells.push({ key: null, day: null });
    for (let d = 1; d <= daysInMonth; d++) {
      const key = `${monthBase.getFullYear()}-${String(monthBase.getMonth() + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      cells.push({ key, day: d });
    }
    return cells;
  }, [monthBase]);

  const zoneName = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? tz;
    } catch {
      return tz;
    }
  }, [tz]);

  const dayHeading = activeDay
    ? new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: tz }).format(new Date(`${activeDay}T12:00:00`))
    : null;

  return (
    <div className="grid gap-0 overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow lg:grid-cols-[340px_1fr]">
      {/* ---- Left: what this call is, and what it will cover ---------------- */}
      <aside className="border-b border-border bg-muted/30 p-6 lg:border-b-0 lg:border-r">
        <p className="section-label">Experience.com</p>
        <h2 className="mt-1 text-[22px] font-bold leading-tight tracking-tight text-foreground">Discovery call</h2>
        <p className="mt-1.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
          <Clock className="h-3.5 w-3.5" /> {minutes} minutes · video or phone
        </p>

        {recommendation.summary && (
          <div className="mt-5 rounded-lg border border-primary/20 bg-accent/50 px-3.5 py-3">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
              <Sparkles className="h-3.5 w-3.5" /> We&rsquo;ve read your enquiry
            </p>
            <p className="mt-1.5 text-[13px] leading-relaxed text-foreground">{recommendation.summary}</p>
          </div>
        )}

        {recommendation.agenda.length > 0 && (
          <div className="mt-5">
            <p className="section-label">What we&rsquo;ll cover</p>
            <ul className="mt-2 space-y-1.5">
              {recommendation.agenda.map((item) => (
                <li key={item} className="flex gap-2 text-[13px] leading-snug text-foreground">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-primary" />
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-2.5 text-[12px] leading-relaxed text-muted-foreground">
              Drawn from what you already told us, so we don&rsquo;t ask you to repeat yourself.
            </p>
          </div>
        )}

        <div className="mt-5">
          <p className="section-label">How long do you need?</p>
          <div className="mt-2 inline-flex rounded-lg border border-input bg-card p-0.5">
            {MEETING_DURATIONS.map((d) => (
              <button
                key={d}
                type="button"
                aria-pressed={minutes === d}
                onClick={() => {
                  setMinutes(d);
                  setSelectedDay(null);
                }}
                className={cn(
                  "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
                  minutes === d ? "bg-navy text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {d === 60 ? "1 hour" : `${d} mins`}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
            {minutes === recommendation.minutes ? recommendation.reason : "You can change this — availability updates to match."}
          </p>
        </div>
      </aside>

      {/* ---- Right: pick a day, then a time --------------------------------- */}
      <div className="p-6">
        <h3 className="text-[17px] font-semibold tracking-tight text-foreground">Select a date &amp; time</h3>

        {error === "slot" && <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">That time was just taken — please choose another.</p>}
        {error === "calendar" && (
          <p className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            We couldn&rsquo;t confirm that time with our calendar. Please try another slot, or we&rsquo;ll reach out to schedule.
          </p>
        )}

        {failed && (
          <p className="mt-6 flex items-center gap-2 text-[13px] text-muted-foreground">
            <CalendarX2 className="h-4 w-4" /> Availability isn&rsquo;t loading right now — no problem, our team will reach out to schedule.
          </p>
        )}

        {!failed && (
          <div className="mt-4 grid gap-6 sm:grid-cols-[minmax(0,1fr)_200px]">
            {/* month grid */}
            <div>
              <div className="mb-2 flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Previous month"
                  disabled={monthOffset === 0}
                  onClick={() => setMonthOffset((m) => Math.max(0, m - 1))}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <p className="text-[14px] font-semibold text-foreground">
                  {new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(monthBase)}
                </p>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() => setMonthOffset((m) => m + 1)}
                  className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => (
                  <span key={d} className="pb-1 text-[10px] font-semibold tracking-wide text-muted-foreground">
                    {d}
                  </span>
                ))}
                {grid.map((cell, i) => {
                  if (!cell.key) return <span key={`pad-${i}`} />;
                  const open = byDay.has(cell.key);
                  const active = activeDay === cell.key;
                  return (
                    <button
                      key={cell.key}
                      type="button"
                      disabled={!open}
                      aria-pressed={active}
                      onClick={() => setSelectedDay(cell.key)}
                      className={cn(
                        "flex h-9 items-center justify-center rounded-full text-[13px] font-medium transition-colors",
                        active
                          ? "bg-primary text-white"
                          : open
                            ? "bg-accent text-primary hover:bg-primary/15"
                            : "text-muted-foreground/40"
                      )}
                    >
                      {cell.day}
                    </button>
                  );
                })}
              </div>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                <Globe className="mt-0.5 h-3 w-3 shrink-0" />
                Times shown in your time zone ({zoneName} · {tz}). Our team is in {data?.timeZone ?? "America/New_York"}.
              </p>
            </div>

            {/* times for the chosen day */}
            <div className="min-w-0">
              {loading && (
                <p className="flex items-center gap-2 py-4 text-[13px] text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking availability…
                </p>
              )}
              {!loading && dayHeading && <p className="mb-2 text-[13px] font-medium text-foreground">{dayHeading}</p>}
              {!loading && openDays.length === 0 && (
                <p className="py-4 text-[13px] text-muted-foreground">
                  No open {minutes}-minute times in the next few days. Try a shorter call, or our team will reach out with options.
                </p>
              )}
              {!loading && slots.length > 0 && (
                <div className="max-h-[320px] space-y-2 overflow-y-auto pr-1">
                  {slots.map((s) => (
                    <form key={s.start} action={bookCustomerSlotAction.bind(null, leadId)} onSubmit={() => setSubmitting(s.start)}>
                      <input type="hidden" name="slot" value={s.start} />
                      <input type="hidden" name="timezone" value={tz} />
                      <input type="hidden" name="minutes" value={minutes} />
                      <button
                        type="submit"
                        disabled={submitting !== null}
                        className={cn(
                          "w-full rounded-lg border border-primary/40 bg-card py-2.5 text-[14px] font-semibold text-primary transition-colors hover:bg-primary hover:text-white disabled:opacity-60",
                          submitting === s.start && "bg-primary text-white"
                        )}
                      >
                        {submitting === s.start ? "Booking…" : s.time}
                      </button>
                    </form>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {data && (
          <p
            className={cn(
              "mt-5 inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px]",
              data.provider.kind === "google" ? "bg-success/10 text-success" : "bg-warning/10 text-warning"
            )}
          >
            {data.provider.label}
          </p>
        )}
      </div>
    </div>
  );
}
