/**
 * Calendar provider boundary for discovery-call booking.
 *
 * The customer-facing booking step only ever sees *availability* (free/busy
 * windows collapsed into bookable slots) — never event titles, attendees or
 * descriptions from anyone's calendar. Two implementations:
 *
 *   GoogleCalendarProvider  — real free/busy + event creation via the Google
 *                             Calendar API with a service account (google.ts)
 *   LocalAvailabilityProvider — deterministic business-hours availability for
 *                             local development, clearly labelled as such
 *
 * `getCalendarProvider()` picks one from configuration and never pretends the
 * fallback is Google: `describe()` tells the UI exactly which is in use.
 */
export interface BusyInterval {
  start: Date;
  end: Date;
}

export interface CreateEventInput {
  /** Calendar to create the event on (a rep's calendar or a shared team calendar). */
  calendarId: string;
  start: Date;
  end: Date;
  summary: string;
  description: string;
  /** IANA time zone the event is expressed in (the sales team's). */
  timeZone: string;
  attendees: { email: string; displayName?: string; optional?: boolean }[];
}

export interface CreatedEvent {
  id: string;
  htmlLink: string | null;
  /** True when Google accepted the attendee list and will send invitations. */
  attendeesInvited: boolean;
  /** Anything the rep should know (e.g. "invitations must be sent manually"). */
  note?: string;
}

export interface ProviderInfo {
  kind: "google" | "local";
  /** Short label for the UI, e.g. "Live availability from Google Calendar · 3 calendars". */
  label: string;
  /** Calendar ids the availability is computed from (emails — shown to the sales side only). */
  calendars: string[];
  configured: boolean;
  /** Why the fallback is active, when it is. */
  reason?: string;
}

export interface CalendarProvider {
  describe(): ProviderInfo;
  /** Busy intervals per calendar id between `from` and `to`. Unknown/inaccessible calendars map to `null`. */
  freeBusy(calendarIds: string[], from: Date, to: Date): Promise<Record<string, BusyInterval[] | null>>;
  createEvent(input: CreateEventInput): Promise<CreatedEvent>;
}
