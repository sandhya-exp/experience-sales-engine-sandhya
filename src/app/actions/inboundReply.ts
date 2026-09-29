"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/authz";
import { getLeadContextOrThrow } from "@/lib/ai/service";
import { getInboundReply, patchInboundReply } from "@/lib/repo/inboundReply";
import { planCallRecapApplication } from "@/lib/ai/callRecap";
import { applyCustomerFacts } from "@/lib/ai/actions";
import { scheduleRefresh } from "@/lib/ai/background";

function revalidateLead(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");
}

export interface ConfirmInboundReplyResult {
  ok: boolean;
  detail: string;
}

/**
 * The salesperson picks which facts an automatically-captured email reply
 * actually supports; only those are written to the opportunity, through the
 * same `applyCustomerFacts` path a confirmed call recap or a submitted reply
 * uses. `planCallRecapApplication` is reused as-is rather than duplicated —
 * it already operates on the same `ExtractedFact` shape `extractFromReply`
 * produces and already supports "only these indices," which is exactly what
 * a webhook-captured reply (no human confirmation at capture time) needs.
 */
export async function confirmInboundReplyFactsAction(leadId: string, activityId: string, formData: FormData): Promise<ConfirmInboundReplyResult> {
  const user = await requireUser();
  const row = await getInboundReply(activityId);
  if (!row || row.leadId !== leadId) return { ok: false, detail: "That inbound reply no longer exists." };

  const confirmedIndices = formData
    .getAll("confirmed")
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n >= 0);
  if (!confirmedIndices.length) return { ok: false, detail: "Select at least one fact to confirm." };

  const ctx = await getLeadContextOrThrow(leadId);
  const plan = planCallRecapApplication(row.meta.facts, row.meta.systems, confirmedIndices, ctx.lead);

  await applyCustomerFacts({
    leadId,
    currentQualification: ctx.lead.qualification ?? {},
    qualificationUpdates: plan.qualificationUpdates,
    contextLines: plan.contextLines,
    actorName: user.name,
  });

  await patchInboundReply(activityId, {
    confirmed_indices: [...new Set([...row.meta.confirmed_indices, ...confirmedIndices])],
    applied: [...row.meta.applied, ...plan.applied],
    confirmed_at: new Date().toISOString(),
    confirmed_by: user.name,
  });

  await scheduleRefresh(leadId, {}, ["/", "/pipeline"]);

  revalidateLead(leadId);
  return { ok: true, detail: plan.applied.length ? `Applied: ${plan.applied.join(", ")}.` : "Nothing new to apply — the record already had this." };
}
