"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { getLeadById } from "@/lib/repo/leads";
import { listContactsForCompany } from "@/lib/repo/contacts";
import { scheduleFollowUp, completeFollowUp, nextFollowUpFor } from "@/lib/repo/followups";
import { getLeadContextOrThrow, regenerateBriefFor } from "@/lib/ai/service";

const MAX_CUSTOMER_BOOKING_DAYS = 14;

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
 * Customer side: the prospect picks a discovery-call slot on the thank-you page
 * right after submitting the inquiry. Public (no session) — so it only accepts
 * a brand-new lead with no booking yet, and only slots the page itself offered
 * (near future, business hours).
 */
export async function bookCustomerSlotAction(leadId: string, formData: FormData) {
  const slot = new Date(String(formData.get("slot") ?? ""));
  const lead = await getLeadById(leadId);
  if (!lead || lead.status !== "new") redirect(`/inquire/thank-you?lead=${leadId}`);
  if (await nextFollowUpFor(leadId)) redirect(`/inquire/thank-you?lead=${leadId}`);

  const now = Date.now();
  const horizon = now + MAX_CUSTOMER_BOOKING_DAYS * 24 * 60 * 60 * 1000;
  if (Number.isNaN(slot.getTime()) || slot.getTime() < now || slot.getTime() > horizon) {
    redirect(`/inquire/thank-you?lead=${leadId}&error=slot`);
  }

  const contacts = await listContactsForCompany(lead.company_id);
  const primary = contacts.find((c) => c.id === lead.primary_contact_id) ?? contacts[0];

  await scheduleFollowUp({
    leadId,
    scheduledFor: slot,
    title: "Discovery call",
    note: "Booked by the customer from the inquiry confirmation page.",
    actorName: primary?.name ?? "Customer",
    source: "customer",
  });
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
