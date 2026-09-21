"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { scheduleFollowUp, completeFollowUp } from "@/lib/repo/followups";
import { bookDiscoveryCall } from "@/lib/calendar/booking";
import { getLeadContextOrThrow, regenerateBriefFor } from "@/lib/ai/service";

async function refreshBrief(leadId: string) {
  try {
    await regenerateBriefFor(await getLeadContextOrThrow(leadId));
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
  if (Number.isNaN(start.getTime())) redirect(`/inquire/thank-you?lead=${leadId}&error=slot`);

  const result = await bookDiscoveryCall({ leadId, start, customerTimeZone: timeZone });
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
