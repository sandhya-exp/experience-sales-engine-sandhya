"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { scheduleFollowUp, completeFollowUp } from "@/lib/repo/followups";
import { bookDiscoveryCall } from "@/lib/calendar/booking";
import { isMeetingDuration } from "@/lib/calendar/recommend";
import { isConferenceKey } from "@/lib/calendar/conferencing";
import { refreshOpportunity } from "@/lib/ai/agent";

/**
 * A booking changes what the agent should do — a call two days out turns the
 * next action into preparing for it — so the same refresh runs here.
 */
async function refreshBrief(leadId: string) {
  try {
    await refreshOpportunity(leadId);
  } catch (err) {
    console.error("Brief refresh after follow-up change failed (non-fatal):", err);
  }
}

function revalidateLead(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/activity");
}

/**
 * Customer side: the prospect picks a discovery-call slot on the Talk to Sales
 * confirmation page. Public (no session) — so it only accepts a brand-new lead
 * with no booking yet, and the slot is re-verified against live availability
 * before anything is written (src/lib/calendar/booking.ts).
 */
export async function bookCustomerSlotAction(leadId: string, formData: FormData) {
  const start = new Date(String(formData.get("slot") ?? ""));
  const timeZone = String(formData.get("timezone") ?? "") || null;
  // Validated against the allowed set, never trusted as sent.
  const rawMinutes = Number(formData.get("minutes"));
  const minutes = isMeetingDuration(rawMinutes) ? rawMinutes : undefined;
  if (Number.isNaN(start.getTime())) redirect(`/inquire/thank-you?lead=${leadId}&error=slot`);

  const repId = String(formData.get("repId") ?? "").trim() || null;
  const rawConference = String(formData.get("conference") ?? "").trim();
  const conferenceKind = isConferenceKey(rawConference) ? rawConference : "meet";
  const conferenceUrl = String(formData.get("conferenceUrl") ?? "").trim();
  // A pasted link is required for the two this app cannot create, and it has
  // to look like one — an empty box would silently produce a meeting nobody can join.
  if ((conferenceKind === "zoom" || conferenceKind === "teams") && !/^https?:\/\/\S+$/i.test(conferenceUrl)) {
    redirect(`/inquire/thank-you?lead=${leadId}&error=conference`);
  }

  const result = await bookDiscoveryCall({
    leadId,
    start,
    customerTimeZone: timeZone,
    minutes,
    preferredRepId: repId,
    conference: { kind: conferenceKind, url: conferenceUrl || null },
  });
  if (!result.ok) {
    const code = result.reason === "slot_unavailable" ? "slot" : result.reason === "provider_error" ? "calendar" : "";
    redirect(`/inquire/thank-you?lead=${leadId}${code ? `&error=${code}` : ""}`);
  }
  await refreshBrief(leadId);
  revalidateLead(leadId);
  redirect(`/inquire/thank-you?lead=${leadId}&booked=1`);
}

/** Rep side: schedule a follow-up from the lead workspace. */
export async function scheduleFollowUpAction(leadId: string, formData: FormData) {
  const date = String(formData.get("date") ?? "");
  const time = String(formData.get("time") ?? "");
  const title = String(formData.get("title") ?? "Follow-up call");
  const note = (formData.get("note") as string) || null;
  const when = new Date(`${date}T${time || "09:00"}`);
  if (!date || Number.isNaN(when.getTime())) return;

  const user = await getCurrentUser();
  await scheduleFollowUp({
    leadId,
    scheduledFor: when,
    title,
    note,
    actorName: user?.name ?? "System",
    source: "rep",
  });
  await refreshBrief(leadId);
  revalidateLead(leadId);
}

export async function completeFollowUpAction(leadId: string, activityId: string) {
  await completeFollowUp(activityId);
  await refreshBrief(leadId);
  revalidateLead(leadId);
}
