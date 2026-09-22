import Link from "next/link";
import { AlertTriangle, CalendarDays, User } from "lucide-react";
import type { ScheduledItem } from "@/lib/repo/schedule";
import { zonedParts } from "@/lib/calendar/time";
import { cn } from "@/lib/utils";

/**
 * The week, as a calendar rather than a list.
 *
 * Days across, business hours down, each booked discovery call a block in the
 * slot it actually occupies — the shape of the week readable at a glance, which
 * three stacked lists never gave. Everything is positioned in the *team's* time
 * zone (the zone availability is computed in), so what a rep sees here is what
 * the customer was offered.
 *
 * A sales week is mostly empty, and that is the design problem: a grid of blank
 * cells tells a rep nothing. So the emptiness is made to carry information —
 * the bookable band (the office hours customers are actually offered) is the
 * white part, everything outside it is shaded, and weekends recede. Reading it,
 * the blank space says "these are the hours still open on Thursday" rather than
 * "nothing here".
 *
 * No client JavaScript: the grid is plain CSS, the week is a URL, and every
 * block is a link to the opportunity. A call that has passed with nothing
 * logged since carries the same warning treatment it has everywhere else.
 */

export interface WeekDay {
  key: string; // YYYY-MM-DD in the team's zone
  label: string; // "Mon"
  dayOfMonth: number;
  isToday: boolean;
  isWeekend: boolean;
}

export interface PlacedMeeting {
  item: ScheduledItem;
  dayKey: string;
  /** Minutes from midnight, team zone. */
  startMinute: number;
  durationMinutes: number;
  overdue: boolean;
}

const PX_PER_MINUTE = 1.15; // ~34px per half-hour: enough for a company name

const hhmm = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return m === 0 ? `${h12} ${ampm}` : `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
};

export function WeekGrid({
  days,
  meetings,
  outside,
  startMinute,
  endMinute,
  officeStart,
  officeEnd,
  timeZone,
  now,
}: {
  days: WeekDay[];
  meetings: PlacedMeeting[];
  /** Calls booked outside business hours — shown as chips rather than stretching the day. */
  outside: PlacedMeeting[];
  startMinute: number;
  endMinute: number;
  /** The hours customers are actually offered — the white band in the grid. */
  officeStart: number;
  officeEnd: number;
  timeZone: string;
  now: Date;
}) {
  const height = (endMinute - startMinute) * PX_PER_MINUTE + 10;
  const y = (min: number) => (min - startMinute) * PX_PER_MINUTE;

  const hourLines: number[] = [];
  for (let m = Math.ceil(startMinute / 60) * 60; m <= endMinute; m += 60) hourLines.push(m);
  const halfLines: number[] = [];
  for (let m = Math.ceil(startMinute / 30) * 30; m <= endMinute; m += 30) if (m % 60 !== 0) halfLines.push(m);

  const nowParts = zonedParts(now, timeZone);
  const nowKey = `${nowParts.year}-${String(nowParts.month).padStart(2, "0")}-${String(nowParts.day).padStart(2, "0")}`;
  const nowMinute = nowParts.hour * 60 + nowParts.minute;
  const nowInView = days.some((d) => d.key === nowKey) && nowMinute >= startMinute && nowMinute <= endMinute;

  const cols = { gridTemplateColumns: `4.25rem repeat(${days.length}, minmax(0, 1fr))` };

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
      {/* Day headers */}
      <div className="grid border-b border-border bg-muted/20" style={cols}>
        <div className="border-r border-border" />
        {days.map((d) => (
          <div key={d.key} className={cn("border-r border-border px-2 py-2.5 text-center last:border-r-0", d.isWeekend && "bg-muted/40")}>
            <p className={cn("section-label", d.isToday ? "text-primary" : d.isWeekend && "text-muted-foreground/70")}>{d.label}</p>
            {/* Today reads as a chip, the way every calendar a rep already uses marks it. */}
            <p
              className={cn(
                "mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-[15px] font-semibold tabular-nums",
                d.isToday ? "bg-primary text-primary-foreground" : d.isWeekend ? "text-muted-foreground/70" : "text-foreground"
              )}
            >
              {d.dayOfMonth}
            </p>
          </div>
        ))}
      </div>

      {/* Booked outside business hours. Stretching the grid to 1 AM for one
          early call would leave a screen of empty rows, so those sit here —
          visible, in their day, and still a link to the opportunity. */}
      {outside.length > 0 && (
        <div className="grid border-b border-border bg-muted/20" style={cols}>
          <div className="flex items-center justify-end border-r border-border px-2 py-2">
            <span className="text-right text-[10px] leading-tight text-muted-foreground">Outside hours</span>
          </div>
          {days.map((d) => (
            <div key={d.key} className="flex flex-wrap gap-1 border-r border-border px-1.5 py-2 last:border-r-0">
              {outside
                .filter((m) => m.dayKey === d.key)
                .map((m) => (
                  <Link
                    key={m.item.activityId}
                    href={`/leads/${m.item.leadId}`}
                    title={`${m.item.companyName} · ${hhmm(m.startMinute)} · ${m.item.title}`}
                    className={cn(
                      "inline-flex max-w-full items-center gap-1 truncate rounded border px-1.5 py-0.5 text-[10px] font-medium transition-colors",
                      m.overdue ? "border-warning/50 bg-warning/10 text-warning hover:border-warning" : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-primary"
                    )}
                  >
                    <span className="tabular-nums">{hhmm(m.startMinute)}</span>
                    <span className="truncate">{m.item.companyName}</span>
                  </Link>
                ))}
            </div>
          ))}
        </div>
      )}

      {/* Time gutter + day columns */}
      <div className="relative grid" style={{ ...cols, height }}>
        {/* Half-hours dashed, hours solid: the rhythm that makes a 30-minute
            block readable as 30 minutes without counting pixels. */}
        {halfLines.map((m) => (
          <div key={`h${m}`} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-dashed border-border/40" style={{ top: y(m) }} />
        ))}
        {hourLines.map((m) => (
          <div key={m} aria-hidden className="pointer-events-none absolute inset-x-0 border-t border-border/70" style={{ top: y(m) }} />
        ))}

        <div className="relative border-r border-border bg-muted/10">
          {hourLines.map((m) => (
            <span key={m} className="absolute right-2 -translate-y-1/2 text-[11px] font-medium tabular-nums text-muted-foreground" style={{ top: y(m) }}>
              {hhmm(m)}
            </span>
          ))}
          {/* The current time, spelled out, so the line below has a label. */}
          {nowInView && (
            <span
              className="absolute right-1.5 z-20 -translate-y-1/2 rounded bg-destructive px-1 py-px text-[10px] font-semibold tabular-nums text-white"
              style={{ top: y(nowMinute) }}
            >
              {hhmm(nowMinute)}
            </span>
          )}
        </div>

        {days.map((d) => {
          const dayMeetings = meetings.filter((m) => m.dayKey === d.key);
          return (
            <div
              key={d.key}
              className={cn("relative border-r border-border last:border-r-0", d.isWeekend ? "bg-muted/60" : d.isToday && "bg-primary/[0.04]")}
            >
              {/* Outside the hours customers are offered. Shading these rather
                  than leaving the whole column blank is what turns empty space
                  into "still bookable" instead of "nothing here". */}
              {officeStart > startMinute && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 bg-muted/70" style={{ height: y(officeStart) }} />
              )}
              {officeEnd < endMinute && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 bg-muted/70" style={{ top: y(officeEnd), bottom: 0 }} />
              )}
              {d.isWeekend && <div aria-hidden className="pointer-events-none absolute inset-0 bg-muted/50" />}

              {dayMeetings.map((m, i) => {
                // Overlapping calls sit side by side rather than on top of each other.
                const overlapping = dayMeetings.filter((o) => o.startMinute < m.startMinute + m.durationMinutes && m.startMinute < o.startMinute + o.durationMinutes);
                const index = overlapping.indexOf(m);
                const width = 100 / overlapping.length;
                const tall = m.durationMinutes >= 30;
                return (
                  <Link
                    key={`${m.item.activityId}-${i}`}
                    href={`/leads/${m.item.leadId}`}
                    title={`${m.item.title} · ${hhmm(m.startMinute)} · ${m.item.companyName}${m.item.ownerName ? ` · ${m.item.ownerName}` : ""}`}
                    className={cn(
                      "group absolute overflow-hidden rounded-md border border-l-[3px] py-1 pl-2 pr-1.5 text-left shadow-sm transition-all hover:shadow-md",
                      m.overdue
                        ? "border-warning/40 border-l-warning bg-warning/10 hover:bg-warning/15"
                        : "border-primary/25 border-l-primary bg-primary/[0.08] hover:bg-primary/15"
                    )}
                    style={{
                      top: y(m.startMinute) + 1,
                      height: Math.max(m.durationMinutes * PX_PER_MINUTE - 3, 24),
                      left: `calc(${index * width}% + 3px)`,
                      width: `calc(${width}% - 6px)`,
                    }}
                  >
                    <p className={cn("truncate text-[11.5px] font-semibold leading-tight", m.overdue ? "text-warning" : "text-primary")}>{m.item.companyName}</p>
                    <p className="truncate text-[10px] leading-tight text-muted-foreground">
                      <span className="tabular-nums">{hhmm(m.startMinute)}</span>
                      {m.item.contactName ? ` · ${m.item.contactName}` : ""}
                    </p>
                    {tall && (m.overdue || m.item.ownerName) && (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] leading-tight text-muted-foreground">
                        {m.overdue ? <AlertTriangle className="h-2.5 w-2.5 shrink-0 text-warning" /> : <User className="h-2.5 w-2.5 shrink-0" />}
                        {m.overdue ? "Nothing logged" : m.item.ownerName}
                      </p>
                    )}
                  </Link>
                );
              })}

              {/* Now */}
              {d.key === nowKey && nowInView && (
                <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10" style={{ top: y(nowMinute) }}>
                  <div className="relative border-t border-destructive">
                    <span className="absolute -left-[3px] -top-[3.5px] block h-[7px] w-[7px] rounded-full bg-destructive" />
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* A week with nothing in it should say so in the middle of the grid,
            where the eye already is, rather than in a sentence underneath. */}
        {meetings.length === 0 && outside.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="flex items-center gap-2.5 rounded-full border border-border bg-card/95 px-4 py-2 text-[12.5px] text-muted-foreground shadow-sm">
              <CalendarDays className="h-4 w-4 text-muted-foreground/70" />
              No calls booked this week — the white band is the time customers can book.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
