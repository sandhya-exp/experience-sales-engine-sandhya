"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarCheck, CalendarX2, Globe, Loader2 } from "lucide-react";
import { bookCustomerSlotAction } from "@/app/actions/followups";
import { cn } from "@/lib/utils";

interface AvailabilityResponse {
  provider: { kind: "google" | "local"; label: string; configured: boolean };
  timeZone: string;
  slotMinutes: number;
  slots: { start: string; end: string }[];
}

/**
 * Discovery-call slot picker on the Talk to Sales confirmation page. Loads
 * live availability from /api/availability and shows it in the customer's own
 * time zone (detected from the browser), with the sales team's zone noted.
 * Picking a slot posts to the booking action, which re-verifies availability
 * and creates the calendar event.
 */
export function SlotPicker({ leadId, error }: { leadId: string; error?: string | null }) {
  const [data, setData] = useState<AvailabilityResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const tz = useMemo(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
      return "UTC";
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/availability", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: AvailabilityResponse) => !cancelled && setData(d))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, []);

  const days = useMemo(() => {
    if (!data) return [];
    const byDay = new Map<string, { label: string; slots: { start: string; time: string }[] }>();
    const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" });
    const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
    const keyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
    for (const s of data.slots) {
      const d = new Date(s.start);
      const key = keyFmt.format(d);
      if (!byDay.has(key)) byDay.set(key, { label: dayFmt.format(d), slots: [] });
      byDay.get(key)!.slots.push({ start: s.start, time: timeFmt.format(d) });
    }
    return [...byDay.entries()].slice(0, 5).map(([key, v]) => ({ key, ...v }));
  }, [data, tz]);

  const zoneName = useMemo(() => {
    try {
      return new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(new Date()).find((p) => p.type === "timeZoneName")?.value ?? tz;
    } catch {
      return tz;
    }
  }, [tz]);

  return (
    <div className="mt-2 w-full text-left">
      <div className="mb-2 flex items-center gap-2">
        <CalendarCheck className="h-4 w-4 text-primary" />
        <p className="text-sm font-semibold text-foreground">Want to skip the back-and-forth? Pick a time for a {data?.slotMinutes ?? 30}-minute discovery call.</p>
      </div>

      {error === "slot" && <p className="mb-2 text-xs text-destructive">That time was just taken — please choose another.</p>}
      {error === "calendar" && <p className="mb-2 text-xs text-destructive">We couldn&apos;t confirm that time with our calendar. Please try another slot, or we&apos;ll reach out to schedule.</p>}

      {!data && !failed && (
        <p className="flex items-center gap-2 py-4 text-[13px] text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking our team&apos;s availability…
        </p>
      )}
      {failed && (
        <p className="flex items-center gap-2 py-3 text-[13px] text-muted-foreground">
          <CalendarX2 className="h-4 w-4" /> Availability isn&apos;t loading right now — no problem, our team will reach out to schedule.
        </p>
      )}

      {data && days.length === 0 && (
        <p className="py-3 text-[13px] text-muted-foreground">No open times in the next few days — our team will reach out with options.</p>
      )}

      {data && days.length > 0 && (
        <div>
          <div role="tablist" aria-label="Choose a day" className="flex flex-wrap gap-1.5">
            {days.map((day) => {
              const active = (selectedDay ?? days[0].key) === day.key;
              return (
                <button
                  key={day.key}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setSelectedDay(day.key)}
                  className={cn(
                    "rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                    active ? "border-navy bg-navy text-white" : "border-border bg-card text-foreground hover:border-navy/40"
                  )}
                >
                  {day.label}
                  <span className={cn("ml-1.5 text-[11px]", active ? "text-white/70" : "text-muted-foreground")}>{day.slots.length}</span>
                </button>
              );
            })}
          </div>
          {(() => {
            const day = days.find((d) => d.key === (selectedDay ?? days[0].key)) ?? days[0];
            return (
              <div role="tabpanel" className="mt-2.5 grid grid-cols-4 gap-1.5 sm:grid-cols-5">
                {day.slots.map((s) => (
                  <form key={s.start} action={bookCustomerSlotAction.bind(null, leadId)} onSubmit={() => setSubmitting(s.start)}>
                    <input type="hidden" name="slot" value={s.start} />
                    <input type="hidden" name="timezone" value={tz} />
                    <button
                      type="submit"
                      disabled={submitting !== null}
                      className={cn(
                        "w-full rounded-md border border-border bg-card px-2 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:border-primary hover:text-primary disabled:opacity-60",
                        submitting === s.start && "border-primary text-primary"
                      )}
                    >
                      {submitting === s.start ? "Booking…" : s.time}
                    </button>
                  </form>
                ))}
              </div>
            );
          })()}
        </div>
      )}

      {data && (
        <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
          <p className="flex items-center gap-1">
            <Globe className="h-3 w-3" /> Times shown in your time zone ({zoneName} · {tz}). Our team is in {data.timeZone}.
          </p>
          <p className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5", data.provider.kind === "google" ? "bg-success/10 text-success" : "bg-warning/10 text-warning")}>
            {data.provider.label}
          </p>
          <p>Booking is optional — we&apos;ll reach out either way.</p>
        </div>
      )}
    </div>
  );
}
