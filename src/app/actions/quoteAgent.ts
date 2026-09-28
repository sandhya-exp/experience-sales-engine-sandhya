"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { prepareQuote, type QuoteProposal } from "@/lib/ai/quoteAgent";
import { runTool, SalesToolTrace, type SalesToolCall } from "@/lib/ai/salesTools";
import { recordActivity } from "@/lib/repo/activities";
import { refreshOpportunity } from "@/lib/ai/agent";
import type { PriceRequestLine } from "@/lib/catalog/pricing";

/** Run the quote-preparation agent. Reads and computes only; nothing is saved but a trace note. */
export async function prepareQuoteAction(leadId: string): Promise<{ ok: boolean; detail: string; proposal?: QuoteProposal }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, detail: "Sign in first." };
  try {
    const proposal = await prepareQuote(leadId, user.name);
    await recordActivity({
      leadId,
      type: "note",
      body: `AI prepared a quote proposal from the catalog (${proposal.trace.length} tool calls, ${proposal.generated_by}). Nothing was created yet.`,
      actorName: "AI agent",
      metadata: { kind: "quote_prep", generated_by: proposal.generated_by, trace: proposal.trace, total: proposal.priced?.totals.total ?? null, approval: proposal.priced?.approval ?? null },
    });
    revalidatePath(`/leads/${leadId}`);
    return { ok: true, detail: "Proposal ready.", proposal };
  } catch (err) {
    console.error("prepareQuote failed:", err);
    return { ok: false, detail: "The quote agent could not run. Try again, or build the quote by hand." };
  }
}

/** The rep accepts the proposal: create a DRAFT through the same tool the agent would use. */
export async function createDraftFromProposalAction(leadId: string, lines: PriceRequestLine[]): Promise<{ ok: boolean; detail: string; trace?: SalesToolCall[] }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, detail: "Sign in first." };
  const trace = new SalesToolTrace();
  // Only codes, quantities and discounts cross from the browser — prices are looked up again server-side.
  const clean = lines.map((l) => ({ product_code: String(l.product_code), quantity: Number(l.quantity), discount_pct: Number(l.discount_pct ?? 0) }));
  const r = await runTool("create_quote_draft", { lead_id: leadId, lines: clean }, { actorName: user.name, trace });
  if (!r.ok) return { ok: false, detail: r.error ?? "Could not create the draft.", trace: trace.calls };
  try {
    await refreshOpportunity(leadId, { actorName: user.name });
  } catch (err) {
    console.error("Refresh after AI draft failed (non-fatal):", err);
  }
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/quotes");
  return { ok: true, detail: `Draft quote created — ${r.summary}.`, trace: trace.calls };
}
