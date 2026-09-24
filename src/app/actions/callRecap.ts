"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/authz";
import { getLeadContextOrThrow } from "@/lib/ai/service";
import { getLatestBrief } from "@/lib/repo/aiBriefs";
import { hasIntelligence } from "@/lib/ai/briefGuards";
import { extractCallRecap, planCallRecapApplication } from "@/lib/ai/callRecap";
import { recordCallRecap, patchCallRecap, getCallRecap, type CallRecapMeta } from "@/lib/repo/callRecap";
import { applyCustomerFacts, primaryContact } from "@/lib/ai/actions";
import { refreshOpportunity } from "@/lib/ai/agent";
import type { Qualification } from "@/lib/types";

function revalidateLead(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");
}

export interface ProcessCallRecapResult {
  ok: boolean;
  detail: string;
  activityId?: string;
}

/**
 * A salesperson pastes (or picks a demo) call transcript and asks the AI to
 * process it. Extraction only proposes — nothing here touches the
 * opportunity's qualification or context. What it does do immediately is
 * become evidence: the transcript is recorded as a `call` activity right
 * away, so the very next brief refresh reads it the same way it reads any
 * other logged call, and the salesperson does not have to confirm anything
 * first for the AI Summary to know the call happened.
 */
export async function processCallRecapAction(leadId: string, formData: FormData): Promise<ProcessCallRecapResult> {
  const user = await requireUser();
  const transcript = String(formData.get("transcript") ?? "").trim();
  if (!transcript) return { ok: false, detail: "Paste a transcript first." };
  if (transcript.length > 20_000) return { ok: false, detail: "That transcript is too long — trim it to the relevant part of the call." };

  const ctx = await getLeadContextOrThrow(leadId);
  const brief = await getLatestBrief(leadId);
  const intelligence = hasIntelligence(brief) ? brief.intelligence : null;
  const contact = primaryContact(ctx.contacts, ctx.lead.primary_contact_id);

  const extraction = await extractCallRecap({
    transcript,
    lead: ctx.lead,
    company: ctx.company,
    contact,
    intelligence,
  });

  const meta: CallRecapMeta = {
    kind: "call_recap",
    transcript,
    facts: extraction.facts.map((f) => ({ field: f.field, label: f.label, value: f.value, quote: f.quote })),
    systems: extraction.systems,
    summary: extraction.summary || "Call transcript processed.",
    next_action: extraction.next_action,
    generated_by: extraction.generated_by,
    model: extraction.model,
    note: extraction.note,
    confirmed_indices: [],
    applied: [],
    confirmed_at: null,
    confirmed_by: null,
  };
  const activity = await recordCallRecap(leadId, meta, user.name);

  // The call is now on the timeline, so the brief re-reads it as evidence the
  // same pass it would read any manually logged call — this is what makes it
  // AI-Summary evidence immediately, not only once facts are confirmed.
  try {
    await refreshOpportunity(leadId);
  } catch (err) {
    console.error("Brief refresh after call recap failed (non-fatal):", err);
  }

  revalidateLead(leadId);
  return { ok: true, activityId: activity.id, detail: `Call processed — ${extraction.facts.length + extraction.systems.length} fact${extraction.facts.length + extraction.systems.length === 1 ? "" : "s"} found.` };
}

export interface ConfirmCallRecapResult {
  ok: boolean;
  detail: string;
}

/**
 * The salesperson picks which extracted facts are correct and worth keeping;
 * only those are written to the opportunity, through the exact same
 * `applyCustomerFacts` a confirmed customer reply uses — one write path for
 * "the customer said this," whether it arrived by email or by phone.
 */
export async function confirmCallRecapFactsAction(leadId: string, activityId: string, formData: FormData): Promise<ConfirmCallRecapResult> {
  const user = await requireUser();
  const row = await getCallRecap(activityId);
  if (!row || row.leadId !== leadId) return { ok: false, detail: "That call recap no longer exists." };

  const confirmedIndices = formData
    .getAll("confirmed")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0);
  if (!confirmedIndices.length) return { ok: false, detail: "Select at least one fact to confirm." };

  const ctx = await getLeadContextOrThrow(leadId);
  // `field` was already validated against the qualification field set at
  // extraction time (see `validateExtraction` in lib/ai/callRecap.ts), so the
  // stored string is safe to treat as the narrower type here.
  const facts = row.meta.facts.map((f) => ({ ...f, field: f.field as keyof Qualification | null }));
  const plan = planCallRecapApplication(facts, row.meta.systems, confirmedIndices, ctx.lead);

  await applyCustomerFacts({
    leadId,
    currentQualification: ctx.lead.qualification ?? {},
    qualificationUpdates: plan.qualificationUpdates,
    contextLines: plan.contextLines,
    actorName: user.name,
  });

  await patchCallRecap(activityId, {
    confirmed_indices: confirmedIndices,
    applied: plan.applied,
    confirmed_at: new Date().toISOString(),
    confirmed_by: user.name,
  });

  try {
    await refreshOpportunity(leadId);
  } catch (err) {
    console.error("Brief refresh after call recap confirmation failed (non-fatal):", err);
  }

  revalidateLead(leadId);
  return { ok: true, detail: plan.applied.length ? `Applied: ${plan.applied.join(", ")}.` : "Nothing new to apply — the record already had this." };
}
