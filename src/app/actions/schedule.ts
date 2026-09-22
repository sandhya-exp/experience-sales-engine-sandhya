"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { getLeadById } from "@/lib/repo/leads";
import { listContactsForCompany } from "@/lib/repo/contacts";
import { listTeam } from "@/lib/repo/users";
import { queryOne } from "@/lib/db";
import { scheduleFollowUp, nextFollowUpFor, type FollowUpCalendar } from "@/lib/repo/followups";
import { schedulingConfig } from "@/lib/calendar/config";
import { getCalendarProvider, verifySlot } from "@/lib/calendar/index";
import { isMeetingDuration } from "@/lib/calendar/recommend";
import { refreshOpportunity } from "@/lib/ai/agent";
import { formatInZone } from "@/lib/calendar/time";
import type { Company } from "@/lib/types";

/**
 * Booking a meeting from the sales side.
 *
 * The customer-facing booking picks whoever on the team is free. This one is
 * the opposite: the opportunity already has an owner, and the point is to get
 * *that person* in front of *that customer*. So the slot is verified against
 * the owner's own calendar, inside office hours, and the meeting is created on
 * it with the customer as an attendee.
 *
 * Conferencing is honest about what this app can and cannot create. Google Meet
 * rides the Calendar integration that already exists, so the link is generated
 * by Google on the event itself. Zoom and Teams would each need their own OAuth
 * application; rather than pretend, the rep pastes their own room link and it is
 * attached to the event and the invitation.
 */
const CONFERENCE_KINDS = ["meet", "zoom", "teams", "none"] as const;
type ConferenceKind = (typeof CONFERENCE_KINDS)[number];

const schema = z.object({
  leadId: z.string().uuid("Choose an opportunity."),
  slot: z.string().min(1, "Choose a time."),
  minutes: z.coerce.number(),
  title: z.string().trim().min(1).max(120).default("Discovery call"),
  note: z.string().trim().max(2000).optional(),
  conference: z.enum(CONFERENCE_KINDS).default("meet"),
  conferenceUrl: z.string().trim().max(500).optional(),
});

export interface ScheduleResult {
  ok: boolean;
  detail: string;
  leadId?: string;
}

export async function createScheduleAction(formData: FormData): Promise<ScheduleResult> {
  const user = await requireUser();
  const parsed = schema.safeParse({
    leadId: formData.get("leadId"),
    slot: formData.get("slot"),
    minutes: formData.get("minutes"),
    title: formData.get("title") || undefined,
    note: formData.get("note") || undefined,
    conference: formData.get("conference") || undefined,
    conferenceUrl: formData.get("conferenceUrl") || undefined,
  });
  if (!parsed.success) return { ok: false, detail: parsed.error.issues[0]?.message ?? "Check the form and try again." };
  const input = parsed.data;

  const kind = input.conference as ConferenceKind;
  // A pasted link is required for the two this app cannot create, and it has to
  // look like one — an empty box would silently produce a meeting nobody can join.
  if ((kind === "zoom" || kind === "teams") && !/^https?:\/\/\S+$/i.test(input.conferenceUrl ?? "")) {
    return { ok: false, detail: `Paste the ${kind === "zoom" ? "Zoom" : "Teams"} meeting link — this app can't create one for you.` };
  }

  const start = new Date(input.slot);
  if (Number.isNaN(start.getTime())) return { ok: false, detail: "That time isn't valid." };
  const minutes = isMeetingDuration(input.minutes) ? input.minutes : schedulingConfig().slotMinutes;

  const lead = await getLeadById(input.leadId);
  if (!lead) return { ok: false, detail: "Opportunity not found." };
  if (await nextFollowUpFor(lead.id)) return { ok: false, detail: "This opportunity already has a meeting booked. Complete or move that one first." };

  const base = schedulingConfig();
  const cfg = minutes !== base.slotMinutes ? { ...base, slotMinutes: minutes } : base;
  const provider = await getCalendarProvider(cfg);

  const [contacts, team, company] = await Promise.all([
    listContactsForCompany(lead.company_id),
    listTeam(),
    queryOne<Company>("select * from companies where id = $1", [lead.company_id]),
  ]);
  const owner = team.find((t) => t.id === lead.owner_user_id) ?? team.find((t) => t.id === user.id) ?? null;
  const customer = contacts.find((c) => c.id === lead.primary_contact_id) ?? contacts[0] ?? null;

  // Re-check against live free/busy rather than trusting the list the browser
  // was shown — it may be a minute old, and the owner may have just been booked.
  const slot = await verifySlot(start, { cfg, provider });
  if (!slot) return { ok: false, detail: "That time is no longer free. Pick another." };
  if (owner && slot.freeReps.length > 0 && !slot.freeReps.includes(owner.email.toLowerCase())) {
    return { ok: false, detail: `${owner.name} is busy then. Pick a time they are free.` };
  }

  const end = new Date(start.getTime() + minutes * 60_000);
  const info = provider.describe();
  let calendar: FollowUpCalendar;
  try {
    const event = await provider.createEvent({
      calendarId: cfg.bookingCalendar ?? owner?.email.toLowerCase() ?? info.calendars[0],
      start,
      end,
      timeZone: cfg.timeZone,
      summary: `${input.title} · ${company?.name ?? "Prospect"} × Experience.com`,
      description: [
        `${input.title} booked by ${user.name} from Sales Engine.`,
        customer ? `Customer: ${customer.name}${customer.email ? ` <${customer.email}>` : ""}` : null,
        company ? `Company: ${company.name}${company.industry ? ` (${company.industry})` : ""}` : null,
        input.note ? `Notes: ${input.note}` : null,
      ]
        .filter(Boolean)
        .join("\n"),
      attendees: [
        ...(customer?.email ? [{ email: customer.email, displayName: customer.name }] : []),
        ...(owner ? [{ email: owner.email.toLowerCase(), displayName: owner.name }] : []),
      ],
      conference: kind === "meet" ? { kind: "meet" } : kind === "none" ? { kind: "none" } : { kind, url: input.conferenceUrl! },
    });
    calendar = {
      provider: info.kind,
      event_id: event.id,
      html_link: event.htmlLink,
      rep_email: owner?.email.toLowerCase() ?? null,
      rep_name: owner?.name ?? null,
      customer_timezone: null,
      duration_minutes: minutes,
      invited: event.attendeesInvited,
      note: event.note,
      conference: { kind, url: event.conferenceUrl ?? null },
    };
  } catch (err) {
    console.error("Rep-side scheduling failed:", err);
    return { ok: false, detail: "The calendar refused that booking. Try another time." };
  }

  await scheduleFollowUp({
    leadId: lead.id,
    scheduledFor: start,
    title: input.title,
    note: [input.note, `Booked by ${user.name}${owner ? ` for ${owner.name}` : ""} · ${labelFor(kind)}`].filter(Boolean).join(" · "),
    actorName: user.name,
    source: "rep",
    calendar,
  });

  // A booked call changes what the agent should do next, so the loop re-runs
  // and the preparation brief is written before anyone opens the opportunity.
  try {
    await refreshOpportunity(lead.id);
  } catch (err) {
    console.error("Brief refresh after scheduling failed (non-fatal):", err);
  }

  revalidatePath("/schedule");
  revalidatePath("/tasks");
  revalidatePath(`/leads/${lead.id}`);
  revalidatePath("/");
  return {
    ok: true,
    leadId: lead.id,
    detail: `${input.title} booked for ${formatInZone(start, cfg.timeZone)}${owner ? ` with ${owner.name}` : ""}.`,
  };
}

function labelFor(kind: ConferenceKind) {
  return kind === "meet" ? "Google Meet" : kind === "zoom" ? "Zoom" : kind === "teams" ? "Microsoft Teams" : "No video link";
}
