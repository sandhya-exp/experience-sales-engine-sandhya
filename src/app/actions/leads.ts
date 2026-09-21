"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { buildHandoffPayload, deliverHandoff } from "@/lib/handoff";
import { DOWNSTREAM } from "@/lib/modules";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getCurrentUser } from "@/lib/auth";
import { assertContractAccess } from "@/lib/authz";
import { recordActivity } from "@/lib/repo/activities";
import {
  updateQualification as updateQualificationRepo,
  updateLeadStatus,
  markQuoted,
  createLead,
  ensureSeedOwnerAssigned,
  getLeadById,
} from "@/lib/repo/leads";
import { addContact, findOrCreateContactForInquiry } from "@/lib/repo/contacts";
import { findOrCreateCompanyForEmail } from "@/lib/repo/companies";
import type { ActivityType, LeadStatus, Qualification, QualificationStatus } from "@/lib/types";
import { getLeadContextOrThrow, regenerateBriefFor } from "@/lib/ai/service";

async function actorName() {
  const user = await getCurrentUser();
  return user?.name ?? "System";
}

export async function logActivityAction(leadId: string, formData: FormData) {
  const type = String(formData.get("type") ?? "note") as ActivityType;
  const body = String(formData.get("body") ?? "");
  const name = await actorName();
  const user = await getCurrentUser();
  await recordActivity({ leadId, type, body, actorUserId: user?.id, actorName: name });
  revalidatePath(`/leads/${leadId}`);
}

export async function updateQualificationAction(leadId: string, formData: FormData) {
  const qualification: Qualification = {
    number_of_users: formData.get("number_of_users") ? Number(formData.get("number_of_users")) : null,
    current_solution: (formData.get("current_solution") as string) || null,
    primary_need: (formData.get("primary_need") as string) || null,
    decision_timeline: (formData.get("decision_timeline") as string) || null,
    decision_maker: (formData.get("decision_maker") as string) || null,
    budget: (formData.get("budget") as string) || null,
  };
  const qualificationStatus = String(formData.get("qualification_status") ?? "in_progress") as QualificationStatus;
  const name = await actorName();
  await updateQualificationRepo(leadId, qualification, qualificationStatus, name);
  // The brief's "missing information" and next step are derived from exactly
  // these fields — refresh it so the Overview never shows stale gaps.
  try {
    await regenerateBriefFor(await getLeadContextOrThrow(leadId));
  } catch (err) {
    console.error("Brief refresh after qualification save failed (non-fatal):", err);
  }
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");
}

export async function updateStageAction(leadId: string, status: LeadStatus) {
  const name = await actorName();
  await updateLeadStatus(leadId, status, name);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");
}

export async function addContactAction(leadId: string, companyId: string, formData: FormData) {
  const name = String(formData.get("name") ?? "");
  const email = String(formData.get("email") ?? "");
  const title = (formData.get("title") as string) || null;
  const makePrimary = formData.get("makePrimary") === "on";
  const actor = await actorName();
  await addContact(companyId, { name, email, title, makePrimary }, leadId, actor);
  revalidatePath(`/leads/${leadId}`);
}

export async function regenerateBriefAction(leadId: string) {
  const ctx = await getLeadContextOrThrow(leadId);
  await regenerateBriefFor(ctx);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");
}

export interface HandoffResult {
  status: "delivered" | "pending" | "not_configured";
  url: string | null;
  detail: string;
}

/**
 * Continue to Quote Ready: the handoff across the boundary (quote → approval → contract → e-signature → renewal).
 * Assembles the full account/deal context, pushes it across, moves the lead
 * to Quoted and records the handoff (with its delivery outcome) on the
 * timeline. Returns where the user should be taken next.
 */
export async function createQuoteHandoffAction(leadId: string): Promise<HandoffResult> {
  // Admin only, checked here rather than only at the button: a server action is
  // a POST to this route, so hiding the control is not a guard.
  if (!(await assertContractAccess())) throw new Error("Not authorised to hand this opportunity to Contract.");
  const name = await actorName();
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;

  // Refresh the AI Deal Brief first so the quote side receives a current
  // narrative rather than one generated before qualification was completed.
  try {
    await regenerateBriefFor(await getLeadContextOrThrow(leadId));
  } catch (err) {
    console.error("Brief refresh before handoff failed (non-fatal):", err);
  }

  const payload = await buildHandoffPayload(leadId, name, origin);
  if (!payload) throw new Error("Lead not found");

  const lead = await getLeadById(leadId);
  const resend = Boolean(lead?.quote_requested_at);
  const delivery = await deliverHandoff(payload);

  if (lead && lead.status !== "quoted" && lead.status !== "won") {
    await markQuoted(leadId, name);
  }
  await recordActivity({
    leadId,
    type: "note",
    body:
      delivery.status === "delivered"
        ? `${resend ? "Updated quote context re-sent" : "Quote context handed"} to ${DOWNSTREAM.partner}: ${payload.contacts.length} contact${payload.contacts.length === 1 ? "" : "s"}, ${payload.sizing.users ?? "—"} users, qualification and ${payload.insights.length} insight${payload.insights.length === 1 ? "" : "s"}.`
        : `Handoff to ${DOWNSTREAM.partner} recorded; it will load the quote context on open.`,
    actorName: name,
    metadata: {
      handoff: {
        resend,
        status: delivery.status,
        detail: delivery.detail,
        target_url: delivery.url,
        account_key: payload.customer.key,
        schema_version: payload.schema_version,
      },
    },
  });

  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");
  return { status: delivery.status, url: delivery.url, detail: delivery.detail };
}

const ManualLeadSchema = z.object({
  companyName: z.string().min(1),
  contactName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  numberOfUsers: z.coerce.number().int().positive(),
  interest: z.string().min(1),
  industry: z.string().optional(),
  requirements: z.string().min(1),
});

export interface ManualLeadFormState {
  errors: Record<string, string>;
  success?: boolean;
}

/** "+ New Lead" from the internal dashboard — e.g. a phone-in inquiry. */
export async function createManualLeadAction(
  _prev: ManualLeadFormState,
  formData: FormData
): Promise<ManualLeadFormState> {
  const parsed = ManualLeadSchema.safeParse({
    companyName: formData.get("companyName"),
    contactName: formData.get("contactName"),
    email: formData.get("email"),
    phone: formData.get("phone") || undefined,
    numberOfUsers: formData.get("numberOfUsers"),
    interest: formData.get("interest"),
    industry: formData.get("industry") || undefined,
    requirements: formData.get("requirements"),
  });
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[issue.path[0] as string] = issue.message;
    return { errors };
  }
  const data = parsed.data;
  const user = await getCurrentUser();

  const { company } = await findOrCreateCompanyForEmail(data.companyName, data.email, data.industry ?? null);
  const contact = await findOrCreateContactForInquiry(company.id, data.contactName, data.email, data.phone ?? null);
  const lead = await createLead({
    companyId: company.id,
    primaryContactId: contact.id,
    numberOfUsers: data.numberOfUsers,
    interest: data.interest,
    requirements: data.requirements,
  });
  if (user) await ensureSeedOwnerAssigned(lead.id, user.id);
  try {
    const ctx = await getLeadContextOrThrow(lead.id);
    await regenerateBriefFor(ctx);
  } catch (err) {
    console.error("Initial AI brief generation failed (non-fatal):", err);
  }
  revalidatePath("/");
  revalidatePath("/pipeline");
  redirect(`/leads/${lead.id}`);
}

export async function reassignLeadAction(leadId: string, ownerUserId: string | null, reason?: string) {
  const { assignLeadOwner } = await import("@/lib/repo/leads");
  const name = await actorName();
  await assignLeadOwner(leadId, ownerUserId, name, reason?.trim() || null);
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/activity");
}

/** "I'll take this one" — for leads that arrived unassigned (API / inbound). */
export async function claimLeadAction(leadId: string) {
  const user = await getCurrentUser();
  if (!user) return;
  const { assignLeadOwner } = await import("@/lib/repo/leads");
  await assignLeadOwner(leadId, user.id, user.name, "claimed");
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");
}

export type PrepareResult = { ok: true } | { ok: false; missing: string[] };

/**
 * "Continue to Quote Ready →": verify the minimum context exists, refresh the
 * intelligence so the Quote Context is final, mark the opportunity Quote Ready
 * on the timeline, and let the client continue to the Quote Context review
 * (which pushes the structured context into Quote Ready).
 */
export async function prepareGuidedSellingAction(leadId: string): Promise<PrepareResult> {
  if (!(await assertContractAccess())) throw new Error("Not authorised to prepare this opportunity for Contract.");
  const { computeReadiness } = await import("@/lib/readiness");
  let ctx = await getLeadContextOrThrow(leadId);
  const readiness = computeReadiness(ctx.lead, ctx.contacts);
  if (!readiness.complete) return { ok: false, missing: readiness.missing };

  const name = await actorName();
  if (ctx.lead.status === "new" || ctx.lead.status === "contacted") {
    await updateLeadStatus(leadId, "qualified", name);
    ctx = await getLeadContextOrThrow(leadId);
  }
  const brief = await regenerateBriefFor(ctx);
  const user = await getCurrentUser();
  await recordActivity({
    leadId,
    type: "note",
    body: `Marked Quote Ready — quote context prepared for ${DOWNSTREAM.partner}.`,
    actorUserId: user?.id,
    actorName: name,
    metadata: { kind: "quote_ready", brief_id: brief.id, quote_context: (brief.intelligence as { quote_context?: unknown }).quote_context ?? null },
  });
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/activity");
  return { ok: true };
}
