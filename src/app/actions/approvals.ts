"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { canApproveQuotes } from "@/lib/roles";
import { getApproval } from "@/lib/repo/approvals";
import { patchActivityMetadata } from "@/lib/repo/agentActions";
import { recordActivity } from "@/lib/repo/activities";
import { getLeadById, updateLeadStatus } from "@/lib/repo/leads";
import { listContactsForCompany } from "@/lib/repo/contacts";
import { emailProvider, deliveryFrom } from "@/lib/email/provider";

/**
 * Resolving an approval request an AI tool raised. This is the only path by
 * which an agent-drafted customer message is sent or a deal is marked Won —
 * and it requires a signed-in person; marking Won additionally requires a
 * manager or admin.
 */
export async function resolveApprovalAction(activityId: string, decision: "approve" | "decline"): Promise<{ ok: boolean; detail: string }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, detail: "Sign in first." };
  const req = await getApproval(activityId);
  if (!req) return { ok: false, detail: "Request not found." };
  if (req.meta.state !== "pending") return { ok: false, detail: "Already resolved." };
  const now = new Date().toISOString();

  if (decision === "decline") {
    await patchActivityMetadata(activityId, { state: "declined", resolved_by: user.name, resolved_at: now, outcome: "Declined" });
    await recordActivity({ leadId: req.leadId, type: "note", body: `Declined: ${req.meta.action === "send_customer_message" ? `sending "${req.meta.subject}"` : "marking Won"}.`, actorUserId: user.id, actorName: user.name });
    revalidate(req.leadId);
    return { ok: true, detail: "Declined." };
  }

  if (req.meta.action === "mark_opportunity_won") {
    if (!canApproveQuotes(user.role)) return { ok: false, detail: "Only a sales manager or an admin can mark a deal Won." };
    await updateLeadStatus(req.leadId, "won", user.name);
    await patchActivityMetadata(activityId, { state: "approved", resolved_by: user.name, resolved_at: now, outcome: "Marked Won" });
    revalidate(req.leadId);
    return { ok: true, detail: "Marked Won." };
  }

  // send_customer_message
  const lead = await getLeadById(req.leadId);
  if (!lead) return { ok: false, detail: "Opportunity not found." };
  const contacts = await listContactsForCompany(lead.company_id);
  const to = contacts.find((c) => c.id === lead.primary_contact_id) ?? contacts.find((c) => c.is_primary) ?? contacts[0];
  if (!to?.email) return { ok: false, detail: "No contact email on record." };
  const result = await emailProvider().send({ to: { name: to.name, email: to.email }, subject: req.meta.subject ?? "Following up", body: req.meta.message ?? "" });
  const delivery = deliveryFrom(result);
  await recordActivity({
    leadId: req.leadId,
    type: "email",
    body: `${req.meta.subject}\n\n${req.meta.message}`,
    actorUserId: user.id,
    actorName: user.name,
    metadata: { kind: "approved_message", approval_id: activityId, delivery },
  });
  await patchActivityMetadata(activityId, { state: "approved", resolved_by: user.name, resolved_at: now, outcome: `${delivery.state}: ${delivery.detail}` });
  revalidate(req.leadId);
  return { ok: delivery.state !== "failed", detail: delivery.state === "failed" ? `Send failed: ${delivery.detail}` : delivery.state === "sent" ? "Sent." : "Recorded (development email provider — not delivered)." };
}

function revalidate(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");
}
