import crypto from "crypto";
import type { BusyInterval, CalendarProvider, CreateEventInput, CreatedEvent, ProviderInfo } from "@/lib/calendar/provider";
import type { ServiceAccount } from "@/lib/calendar/config";

/**
 * Google Calendar via a service account — plain REST, no SDK (matches how the
 * app already talks to Google for sign-in). Two endpoints only:
 *   POST /calendar/v3/freeBusy                       → busy windows per calendar (no event details)
 *   POST /calendar/v3/calendars/{id}/events          → the discovery-call event
 *
 * Access: each rep shares their calendar with the service account email
 * ("See only free/busy" is enough for availability; "Make changes to events"
 * on the booking calendar for event creation). With domain-wide delegation
 * (GOOGLE_CALENDAR_IMPERSONATE) the service account acts as that user, which
 * is what lets Google send invitations to the customer and the rep.
 */
const SCOPES = ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.readonly"].join(" ");

export class GoogleCalendarProvider implements CalendarProvider {
  private token: { value: string; expiresAt: number } | null = null;

  constructor(
    private readonly account: ServiceAccount,
    private readonly calendars: string[],
    private readonly opts: { impersonate: string | null; apiBase: string; tokenUrl?: string }
  ) {}

  describe(): ProviderInfo {
    return {
      kind: "google",
      label: `Live availability from Google Calendar · ${this.calendars.length} ${this.calendars.length === 1 ? "calendar" : "calendars"}`,
      calendars: this.calendars,
      configured: true,
    };
  }

  async freeBusy(calendarIds: string[], from: Date, to: Date): Promise<Record<string, BusyInterval[] | null>> {
    const res = await this.call("/calendar/v3/freeBusy", {
      method: "POST",
      body: JSON.stringify({ timeMin: from.toISOString(), timeMax: to.toISOString(), items: calendarIds.map((id) => ({ id })) }),
    });
    const data = (await res.json()) as { calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: unknown[] }> };
    const out: Record<string, BusyInterval[] | null> = {};
    for (const id of calendarIds) {
      const c = data.calendars?.[id];
      if (!c || (c.errors && c.errors.length)) out[id] = null;
      else out[id] = (c.busy ?? []).map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));
    }
    return out;
  }

  async createEvent(input: CreateEventInput): Promise<CreatedEvent> {
    const body = {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
      end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
      attendees: input.attendees,
      reminders: { useDefault: true },
    };
    const path = `/calendar/v3/calendars/${encodeURIComponent(input.calendarId)}/events?sendUpdates=all`;
    let res = await this.call(path, { method: "POST", body: JSON.stringify(body) }, { allowError: true });
    let attendeesInvited = true;
    let note: string | undefined;
    if (res.status === 403) {
      // Without domain-wide delegation Google refuses attendee lists from service accounts
      // ("forbiddenForServiceAccounts"). Create the event without attendees rather than fail
      // the booking, and say so — the rep sends the invitation.
      const err = await res.text();
      if (/forbiddenForServiceAccounts|attendees/i.test(err)) {
        attendeesInvited = false;
        note = "Google would not send invitations from the service account (no domain-wide delegation) — the event is on the team calendar; the rep sends the invite.";
        res = await this.call(path.replace("?sendUpdates=all", ""), { method: "POST", body: JSON.stringify({ ...body, attendees: undefined }) });
      } else {
        throw new Error(`Google Calendar events.insert 403: ${err.slice(0, 200)}`);
      }
    }
    const data = (await res.json()) as { id: string; htmlLink?: string };
    return { id: data.id, htmlLink: data.htmlLink ?? null, attendeesInvited, note };
  }

  /* ------------------------------------------------------------ transport */

  private async call(path: string, init: RequestInit, opts: { allowError?: boolean } = {}) {
    const token = await this.accessToken();
    const res = await fetch(`${this.opts.apiBase}${path}`, {
      ...init,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok && !(opts.allowError && res.status === 403)) {
      throw new Error(`Google Calendar ${path.split("?")[0]} → ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
    return res;
  }

  /** Service-account JWT → OAuth access token (cached until a minute before expiry). */
  private async accessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;
    const now = Math.floor(Date.now() / 1000);
    const claims: Record<string, unknown> = { iss: this.account.clientEmail, scope: SCOPES, aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 };
    if (this.opts.impersonate) claims.sub = this.opts.impersonate;
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const unsigned = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claims)}`;
    const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), this.account.privateKey).toString("base64url");
    const res = await fetch(this.opts.tokenUrl ?? `${this.opts.apiBase === "https://www.googleapis.com" ? "https://oauth2.googleapis.com" : this.opts.apiBase}/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${signature}` }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Google token exchange failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const data = (await res.json()) as { access_token: string; expires_in?: number };
    this.token = { value: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
    return this.token.value;
  }
}
