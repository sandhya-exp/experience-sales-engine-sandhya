import { query } from "@/lib/db";
import type { BusyInterval, CalendarProvider, CreateEventInput, CreatedEvent, ProviderInfo } from "@/lib/calendar/provider";
import { FOLLOW_UP_KIND } from "@/lib/repo/followups";

/**
 * Local development fallback. NOT Google Calendar and never presented as such:
 * `describe()` labels it "Demo availability", and the booking UI shows that
 * label to the customer and the sales side.
 *
 * Availability = the team's business hours minus discovery calls already
 * booked in this database (so a slot can't be double-booked in a demo). Events
 * are not created anywhere; the booking is stored on the opportunity only.
 */
export class LocalAvailabilityProvider implements CalendarProvider {
  constructor(private readonly calendars: string[], private readonly reason: string) {}

  describe(): ProviderInfo {
    return {
      kind: "local",
      label: "Demo availability — Google Calendar not configured",
      calendars: this.calendars,
      configured: false,
      reason: this.reason,
    };
  }

  async freeBusy(calendarIds: string[], from: Date, to: Date): Promise<Record<string, BusyInterval[] | null>> {
    // Every booked, not-completed discovery call in the workspace blocks the rep it was assigned to
    // (or everyone, for bookings made before rep assignment existed).
    const rows = await query<{ metadata: Record<string, unknown> }>(
      `select metadata from activities
       where metadata->>'kind' = $1
         and coalesce((metadata->>'completed')::boolean, false) = false
         and (metadata->>'scheduled_for')::timestamptz between $2 and $3`,
      [FOLLOW_UP_KIND, from.toISOString(), to.toISOString()]
    );
    const out: Record<string, BusyInterval[]> = Object.fromEntries(calendarIds.map((id) => [id, [] as BusyInterval[]]));
    for (const r of rows) {
      const start = new Date(String(r.metadata.scheduled_for));
      const minutes = Number((r.metadata.calendar as { duration_minutes?: number } | undefined)?.duration_minutes ?? 30);
      const end = new Date(start.getTime() + minutes * 60_000);
      const rep = (r.metadata.calendar as { rep_email?: string } | undefined)?.rep_email;
      const targets = rep && out[rep] ? [rep] : calendarIds;
      for (const id of targets) out[id].push({ start, end });
    }
    return out;
  }

  async createEvent(input: CreateEventInput): Promise<CreatedEvent> {
    return {
      id: `local-${input.start.getTime()}`,
      htmlLink: null,
      attendeesInvited: false,
      note: "Demo mode — no calendar event was created because Google Calendar is not configured.",
    };
  }
}
