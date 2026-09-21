import { getLeadById } from "@/lib/repo/leads";
import { listContactsForCompany } from "@/lib/repo/contacts";
import { listTeam } from "@/lib/repo/users";
import { queryOne } from "@/lib/db";
import { nextFollowUpFor, scheduleFollowUp, type FollowUpCalendar } from "@/lib/repo/followups";
import { schedulingConfig } from "@/lib/calendar/config";
import { getCalendarProvider, verifySlot } from "@/lib/calendar/index";
import { formatInZone, isValidTimeZone } from "@/lib/calendar/time";
import type { Company } from "@/lib/types";

export type BookingResult =
  | { ok: true; activityId: string; calendar: FollowUpCalendar; start: Date; end: Date }
  | { ok: false; reason: "lead_not_bookable" | "already_booked" | "slot_unavailable" | "provider_error"; detail?: string };

/**
 * Book a discovery call for a lead at `start`.
 *
 * 1. Re-verify the slot against live free/busy (never trust the browser's list).
 * 2. Pick the rep: the lead's owner if free, otherwise the first free rep.
 * 3. Create the calendar event through the provider (Google, or the labelled local fallback).
 * 4. Store the appointment on the opportunity as a follow-up with the calendar details,
 *    so the workspace header, timeline and AI next-action all see it.
 */
export async function bookDiscoveryCall(input: { leadId: string; start: Date; customerTimeZone?: string | null }): Promise<BookingResult> {
  const lead = await getLeadById(input.leadId);
  if (!lead || lead.status !== "new") return { ok: false, reason: "lead_not_bookable" };
  if (await nextFollowUpFor(lead.id)) return { ok: false, reason: "already_booked" };

  const cfg = schedulingConfig();
  const provider = await getCalendarProvider(cfg);
  const slot = await verifySlot(input.start, { cfg, provider });
  if (!slot) return { ok: false, reason: "slot_unavailable" };
  const start = new Date(slot.start);
  const end = new Date(slot.end);

  const [contacts, team, company] = await Promise.all([
    listContactsForCompany(lead.company_id),
    listTeam(),
    queryOne<Company>("select * from companies where id = $1", [lead.company_id]),
  ]);
  const customer = contacts.find((c) => c.id === lead.primary_contact_id) ?? contacts[0];
  const owner = team.find((t) => t.id === lead.owner_user_id);
  const repEmail = owner && slot.freeReps.includes(owner.email.toLowerCase()) ? owner.email.toLowerCase() : slot.freeReps[0] ?? owner?.email.toLowerCase() ?? null;
  const rep = team.find((t) => t.email.toLowerCase() === repEmail) ?? null;
  const customerTz = isValidTimeZone(input.customerTimeZone) ? input.customerTimeZone : null;

  const info = provider.describe();
  let calendar: FollowUpCalendar;
  try {
    const event = await provider.createEvent({
      calendarId: cfg.bookingCalendar ?? repEmail ?? info.calendars[0],
      start,
      end,
      timeZone: cfg.timeZone,
      summary: `Discovery call · ${company?.name ?? "Prospect"} × Experience.com`,
      description: [
        `Discovery call booked by the customer from Talk to Sales.`,
        customer ? `Customer: ${customer.name}${customer.email ? ` <${customer.email}>` : ""}${customer.phone ? ` · ${customer.phone}` : ""}` : null,
        company ? `Company: ${company.name}${company.industry ? ` (${company.industry})` : ""}` : null,
        lead.interest ? `Interested in: ${lead.interest}` : null,
        lead.number_of_users ? `Users: ${lead.number_of_users}` : null,
        customerTz ? `Customer time zone: ${customerTz} (${formatInZone(start, customerTz)})` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      attendees: [
        ...(customer?.email ? [{ email: customer.email, displayName: customer.name }] : []),
        ...(repEmail ? [{ email: repEmail, displayName: rep?.name }] : []),
      ],
    });
    calendar = {
      provider: info.kind,
      event_id: event.id,
      html_link: event.htmlLink,
      rep_email: repEmail,
      rep_name: rep?.name ?? null,
      customer_timezone: customerTz,
      duration_minutes: cfg.slotMinutes,
      invited: event.attendeesInvited,
      note: event.note,
    };
  } catch (err) {
    console.error("Calendar event creation failed:", err);
    return { ok: false, reason: "provider_error", detail: err instanceof Error ? err.message : String(err) };
  }

  const activity = await scheduleFollowUp({
    leadId: lead.id,
    scheduledFor: start,
    title: "Discovery call",
    note: `Booked by the customer from Talk to Sales${rep ? ` with ${rep.name}` : ""}${info.kind === "google" ? " · Google Calendar" : " · demo availability (Google Calendar not configured)"}${customerTz ? ` · customer time zone ${customerTz}` : ""}.`,
    actorName: customer?.name ?? "Customer",
    source: "customer",
    calendar,
  });
  return { ok: true, activityId: activity.id, calendar, start, end };
}
