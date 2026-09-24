import { getLeadById } from "@/lib/repo/leads";
import { listContactsForCompany } from "@/lib/repo/contacts";
import { listTeam } from "@/lib/repo/users";
import { queryOne } from "@/lib/db";
import { nextFollowUpFor, scheduleFollowUp, type FollowUpCalendar } from "@/lib/repo/followups";
import { recordActivity } from "@/lib/repo/activities";
import { schedulingConfig } from "@/lib/calendar/config";
import { getCalendarProvider, verifySlot } from "@/lib/calendar/index";
import { formatInZone, isValidTimeZone } from "@/lib/calendar/time";
import { isConferenceKey, CONFERENCE_LABEL, type ConferenceKey } from "@/lib/calendar/conferencing";
import { googleCalendarAddLink } from "@/lib/calendar/addLink";
import { emailProvider, deliveryFrom } from "@/lib/email/provider";
import { smsProvider } from "@/lib/sms/provider";
import type { Company, Contact } from "@/lib/types";

export type BookingResult =
  | { ok: true; activityId: string; calendar: FollowUpCalendar; start: Date; end: Date }
  | { ok: false; reason: "lead_not_bookable" | "already_booked" | "slot_unavailable" | "provider_error"; detail?: string };

/**
 * Book a discovery call for a lead at `start`.
 *
 * 1. Re-verify the slot against live free/busy (never trust the browser's list).
 * 2. Pick the rep: whoever the customer chose (if still free), otherwise the
 *    lead's owner if free, otherwise the first free rep.
 * 3. Create the calendar event through the provider (Google, or the labelled local fallback),
 *    with the video option the customer chose.
 * 4. Store the appointment on the opportunity as a follow-up with the calendar details,
 *    so the workspace header, timeline and AI next-action all see it.
 * 5. Confirm the booking back to the customer by email (and text, if a phone
 *    number was given) — non-fatal, so a delivery hiccup never undoes a real booking.
 */
export async function bookDiscoveryCall(input: {
  leadId: string;
  start: Date;
  customerTimeZone?: string | null;
  minutes?: number;
  /** A specific rep the customer picked on the booking screen, by id. */
  preferredRepId?: string | null;
  /** How the customer wants to meet. Defaults to Google Meet. */
  conference?: { kind: ConferenceKey; url?: string | null } | null;
}): Promise<BookingResult> {
  const lead = await getLeadById(input.leadId);
  if (!lead || lead.status !== "new") return { ok: false, reason: "lead_not_bookable" };
  if (await nextFollowUpFor(lead.id)) return { ok: false, reason: "already_booked" };

  const base = schedulingConfig();
  // The customer may have chosen a length other than the default; everything
  // downstream — verification, the event, the stored appointment — uses it.
  const cfg = input.minutes && input.minutes !== base.slotMinutes ? { ...base, slotMinutes: input.minutes } : base;
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
  const preferred = input.preferredRepId ? team.find((t) => t.id === input.preferredRepId) : undefined;
  const owner = team.find((t) => t.id === lead.owner_user_id);
  // The customer's chosen specialist wins if they're still free for this slot
  // (free/busy can have shifted between loading the page and submitting); a
  // slot the browser never should have offered for that person falls back the
  // same way an unassigned lead already does, rather than failing the booking.
  const wanted = preferred ?? owner;
  const repEmail = wanted && slot.freeReps.includes(wanted.email.toLowerCase()) ? wanted.email.toLowerCase() : slot.freeReps[0] ?? wanted?.email.toLowerCase() ?? null;
  const rep = team.find((t) => t.email.toLowerCase() === repEmail) ?? null;
  const customerTz = isValidTimeZone(input.customerTimeZone) ? input.customerTimeZone : null;
  const conferenceKind: ConferenceKey = input.conference && isConferenceKey(input.conference.kind) ? input.conference.kind : "meet";

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
      conference:
        conferenceKind === "meet"
          ? { kind: "meet" }
          : conferenceKind === "none"
            ? { kind: "none" }
            : { kind: conferenceKind, url: input.conference?.url && /^https?:\/\/\S+$/i.test(input.conference.url) ? input.conference.url : "" },
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
      conference: { kind: conferenceKind, url: event.conferenceUrl ?? null },
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

  // The booking itself already succeeded — a confirmation that fails to send
  // is recorded, not a reason to tell the customer their call didn't book.
  try {
    await sendBookingConfirmation({
      leadId: lead.id,
      customer,
      companyName: company?.name ?? "your organization",
      repName: rep?.name ?? null,
      start,
      end,
      teamTz: cfg.timeZone,
      customerTz,
      conference: calendar.conference ?? null,
      htmlLink: calendar.html_link,
    });
  } catch (err) {
    console.error("Booking confirmation send failed (non-fatal):", err);
  }

  return { ok: true, activityId: activity.id, calendar, start, end };
}

/**
 * Confirm the booking back to the customer, the moment it exists — an email
 * always, an SMS too when they gave a number. Neither can block the booking
 * itself. Each attempt becomes its own activity, the same "recorded, not
 * thrown away" treatment the agent's own customer messages already get — so a
 * salesperson looking at the timeline sees exactly what the customer was told
 * and whether it actually reached them, not just that a booking happened.
 */
async function sendBookingConfirmation(args: {
  leadId: string;
  customer: Contact | undefined;
  companyName: string;
  repName: string | null;
  start: Date;
  end: Date;
  teamTz: string;
  customerTz: string | null;
  conference: FollowUpCalendar["conference"];
  htmlLink: string | null;
}) {
  const { customer, repName, start, end, teamTz, customerTz, conference, htmlLink, companyName } = args;
  const displayTz = customerTz ?? teamTz;
  const when = formatInZone(start, displayTz);
  const meetingLabel = conference ? CONFERENCE_LABEL[conference.kind] : "Google Meet";
  const joinLink = conference?.url ?? htmlLink ?? googleCalendarAddLink({ title: `Discovery call · ${companyName} × Experience.com`, start, end, location: meetingLabel });

  if (customer?.email) {
    const firstName = customer.name.split(" ")[0] || customer.name;
    const body = [
      `Hi ${firstName},`,
      "",
      "Thanks for reaching out to Experience.com.",
      "We've received your inquiry and scheduled your discovery conversation.",
      "",
      "Your meeting",
      when,
      repName ?? "Experience.com Sales",
      meetingLabel,
      "",
      "We'll use this conversation to understand your requirements and discuss how Experience.com can support your organization.",
      `Meeting link: ${joinLink}`,
      "",
      "Thanks,",
      "Experience.com Sales Team",
    ].join("\n");
    const result = await emailProvider().send({ to: { name: customer.name, email: customer.email }, subject: "Your Experience.com sales conversation is confirmed", body });
    const delivery = deliveryFrom(result);
    await recordActivity({
      leadId: args.leadId,
      type: "email",
      body: `Booking confirmation email to ${customer.email} — ${delivery.detail}`,
      actorName: "Experience.com Sales",
      metadata: { kind: "booking_confirmation_email", delivery },
    });
  }

  if (customer?.phone) {
    const body = `Experience.com: Your sales conversation is confirmed for ${when}${repName ? ` with ${repName}` : ""}. Your meeting details have been emailed to you.`;
    const result = await smsProvider().send({ to: customer.phone, body });
    const delivery = result.ok
      ? { state: "recorded" as const, provider: result.provider, mode: result.mode, message_id: result.id, detail: result.detail, at: new Date().toISOString() }
      : { state: "failed" as const, provider: result.provider, mode: result.mode, message_id: null, detail: result.error, at: new Date().toISOString() };
    await recordActivity({
      leadId: args.leadId,
      type: "message",
      body: `Booking confirmation text to ${customer.phone} — ${delivery.detail}`,
      actorName: "Experience.com Sales",
      metadata: { kind: "booking_confirmation_sms", delivery },
    });
  }
}
