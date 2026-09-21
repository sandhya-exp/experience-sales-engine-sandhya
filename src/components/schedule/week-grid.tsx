import Link from "next/link";
import { AlertTriangle, User } from "lucide-react";
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

const PX_PER_MINUTE = 1.1; // ~33px per half-hour: enough for a company name

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
  timeZone,
  now,
}: {
  days: WeekDay[];
  meetings: PlacedMeeting[];
  /** Calls booked outside business hours — shown as chips rather than stretching the day. */
  outside: PlacedMeeting[];
  startMinute: number;
  endMinute: number;
  timeZone: string;
  now: Date;
}) {
  const height = (endMinute - startMinute) * PX_PER_MINUTE + 10;
  const hourLines: number[] = [];
  for (let m = Math.ceil(startMinute / 60) * 60; m <= endMinute; m += 60) hourLines.push(m);

  const nowParts = zonedParts(now, timeZone);
  const nowKey = `${nowParts.year}-${String(nowParts.month).padStart(2, "0")}-${String(nowParts.day).padStart(2, "0")}`;
  const nowMinute = nowParts.hour * 60 + nowParts.minute;
  const nowInView = days.some((d) => d.key === nowKey) && nowMinute >= startMinute && nowMinute <= endMinute;

  return (
    <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
      {/* Day headers */}
      <div className="grid border-b border-border" style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="border-r border-border" />
        {days.map((d) => (
          <div
            key={d.key}
            className={cn(
              "border-r border-border px-2 py-2.5 text-center last:border-r-0",
              d.isWeekend && "bg-muted/30",
              d.isToday && "bg-primary/5"
            )}
          >
            <p className={cn("section-label", d.isToday && "text-primary")}>{d.label}</p>
            <p className={cn("mt-0.5 text-[15px] font-semibold tabular-nums", d.isToday ? "text-primary" : "text-foreground")}>{d.dayOfMonth}</p>
          </div>
        ))}
      </div>

      {/* Booked outside business hours. Stretching the grid to 1 AM for one
          early call would leave a screen of empty rows, so those sit here —
          visible, in their day, and still a link to the opportunity. */}
      {outside.length > 0 && (
        <div className="grid border-b border-border bg-muted/20" style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))` }}>
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
      <div className="relative grid" style={{ gridTemplateColumns: `4rem repeat(${days.length}, minmax(0, 1fr))`, height }}>
        {/* Hour lines, drawn once across the whole grid */}
        {hourLines.map((m) => (
          <div
            key={m}
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-border/60"
            style={{ top: (m - startMinute) * PX_PER_MINUTE }}
          />
        ))}

        <div className="relative border-r border-border">
          {hourLines.map((m) => (
            <span
              key={m}
              className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-muted-foreground"
              style={{ top: (m - startMinute) * PX_PER_MINUTE }}
            >
              {hhmm(m)}
            </span>
          ))}
        </div>

        {days.map((d) => {
          const dayMeetings = meetings.filter((m) => m.dayKey === d.key);
          return (
            <div key={d.key} className={cn("relative border-r border-border last:border-r-0", d.isWeekend && "bg-muted/20", d.isToday && "bg-primary/[0.03]")}>
              {dayMeetings.map((m, i) => {
                // Overlapping calls sit side by side rather than on top of each other.
                const overlapping = dayMeetings.filter(
                  (o) => o.startMinute < m.startMinute + m.durationMinutes && m.startMinute < o.startMinute + o.durationMinutes
                );
                const index = overlapping.indexOf(m);
                const width = 100 / overlapping.length;
                return (
                  <Link
                    key={`${m.item.activityId}-${i}`}
                    href={`/leads/${m.item.leadId}`}
                    title={`${m.item.title} · ${hhmm(m.startMinute)} · ${m.item.companyName}${m.item.ownerName ? ` · ${m.item.ownerName}` : ""}`}
                    className={cn(
                      "absolute overflow-hidden rounded-md border px-1.5 py-1 text-left transition-colors",
                      m.overdue
                        ? "border-warning/50 bg-warning/10 hover:border-warning"
                        : "border-primary/30 bg-primary/10 hover:border-primary/60 hover:bg-primary/15"
                    )}
                    style={{
                      top: (m.startMinute - startMinute) * PX_PER_MINUTE,
                      height: Math.max(m.durationMinutes * PX_PER_MINUTE - 2, 22),
                      left: `calc(${index * width}% + 2px)`,
                      width: `calc(${width}% - 4px)`,
                    }}
                  >
                    <p className={cn("truncate text-[11px] font-semibold leading-tight", m.overdue ? "text-warning" : "text-primary")}>
                      {m.item.companyName}
                    </p>
                    <p className="truncate text-[10px] leading-tight text-muted-foreground">
                      {hhmm(m.startMinute)}
                      {m.item.contactName ? ` · ${m.item.contactName}` : ""}
                    </p>
                    {m.durationMinutes >= 30 && m.item.ownerName && (
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
                <div aria-hidden className="pointer-events-none absolute inset-x-0 z-10" style={{ top: (nowMinute - startMinute) * PX_PER_MINUTE }}>
                  <div className="relative border-t border-destructive">
                    <span className="absolute -left-[3px] -top-[3.5px] block h-[7px] w-[7px] rounded-full bg-destructive" />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
