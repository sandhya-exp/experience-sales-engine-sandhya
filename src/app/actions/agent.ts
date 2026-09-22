"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { setAutoMode } from "@/lib/ai/actions";
import { handleCustomerReply, refreshOpportunity, runAction } from "@/lib/ai/agent";
import { declineAgentAction } from "@/lib/ai/actions";
import { getAgentAction } from "@/lib/repo/agentActions";

/**
 * The agent's server actions.
 *
 * Every one of these is a POST to this route whether or not a button is
 * rendered, so the checks live here: who is signed in, what the action's risk
 * band allows, and — for anything that leaves the building — that a person
 * actually approved this specific action. Hiding a control is not a guard.
 */

async function actor() {
  const user = await getCurrentUser();
  return { id: user?.id ?? null, name: user?.name ?? null };
}

function revalidateLead(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/tasks");
  revalidatePath("/activity");
}

export interface AgentActionResult {
  ok: boolean;
  detail: string;
}

/** Re-run the intelligence and propose the next action. */
export async function refreshAgentAction(leadId: string): Promise<AgentActionResult> {
  const { name } = await actor();
  if (!name) return { ok: false, detail: "Sign in first." };
  const result = await refreshOpportunity(leadId, { actorName: name });
  revalidateLead(leadId);
  return { ok: true, detail: result.action ? `Proposed: ${result.action.meta.goal}` : "Nothing to propose — the opportunity has no open gap the agent can close." };
}

/**
 * Approve and run an action. A person is approving THIS action, so the id is
 * re-read server-side and its risk band decides what happens: a red action is
 * still executed only because a person pressed the button, and never by the
 * automatic path.
 */
export async function approveAgentAction(activityId: string, formData?: FormData): Promise<AgentActionResult> {
  const { name } = await actor();
  if (!name) return { ok: false, detail: "Sign in first." };
  const row = await getAgentAction(activityId);
  if (!row) return { ok: false, detail: "That action no longer exists." };

  const result = await runAction({
    activityId,
    approvedBy: name,
    editedSubject: formData ? (formData.get("subject") as string | null) : null,
    editedBody: formData ? (formData.get("body") as string | null) : null,
    auto: false,
  });
  revalidateLead(row.leadId);
  return { ok: result.ok, detail: result.detail };
}

export async function declineAgentActionAction(activityId: string, reason?: string): Promise<AgentActionResult> {
  const { name } = await actor();
  if (!name) return { ok: false, detail: "Sign in first." };
  const row = await getAgentAction(activityId);
  if (!row) return { ok: false, detail: "That action no longer exists." };
  await declineAgentAction(activityId, name, reason ?? null);
  revalidateLead(row.leadId);
  return { ok: true, detail: "Declined. The agent will propose something else on the next refresh." };
}

/** Turn automatic execution of low-risk actions on or off for one opportunity. */
export async function setAutoModeAction(leadId: string, enabled: boolean): Promise<AgentActionResult> {
  const { name } = await actor();
  if (!name) return { ok: false, detail: "Sign in first." };
  await setAutoMode(leadId, enabled, name);
  revalidateLead(leadId);
  return { ok: true, detail: enabled ? "Low-risk actions will now run automatically on this opportunity." : "Automatic execution is off; every action needs approval." };
}

export interface ReplyActionResult extends AgentActionResult {
  applied: string[];
  resolvedGaps: string[];
  readinessBefore: string | null;
  readinessAfter: string | null;
  nextAction: string | null;
}

/**
 * Record a customer's reply and let the loop run. The reply text is the
 * customer's own words — everything written to the opportunity has to be
 * quotable from it, which `lib/ai/reply.ts` enforces before anything is saved.
 */
export async function customerReplyAction(leadId: string, formData: FormData): Promise<ReplyActionResult> {
  const { name } = await actor();
  if (!name) return { ok: false, detail: "Sign in first.", applied: [], resolvedGaps: [], readinessBefore: null, readinessAfter: null, nextAction: null };
  const text = String(formData.get("text") ?? "").trim();
  const inReplyTo = (formData.get("inReplyTo") as string | null) || null;
  if (!text) return { ok: false, detail: "Enter the customer's reply.", applied: [], resolvedGaps: [], readinessBefore: null, readinessAfter: null, nextAction: null };

  const result = await handleCustomerReply({ leadId, text, inReplyToActivityId: inReplyTo, actorName: name });
  revalidateLead(leadId);

  const fmt = (r: { passed: number; total: number } | null) => (r ? `${r.passed}/${r.total}` : null);
  return {
    ok: true,
    detail: result.applied.length ? `Applied ${result.applied.length} fact${result.applied.length === 1 ? "" : "s"} from the reply.` : "Nothing in the reply could be quoted as a new fact, so nothing was changed.",
    applied: result.applied,
    resolvedGaps: result.resolvedGaps,
    readinessBefore: fmt(result.readinessBefore),
    readinessAfter: fmt(result.readinessAfter),
    nextAction: result.nextActionAfter,
  };
}
