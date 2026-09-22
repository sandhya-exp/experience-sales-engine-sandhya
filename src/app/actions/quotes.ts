"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { getLeadById } from "@/lib/repo/leads";
import { getLatestBrief } from "@/lib/repo/aiBriefs";
import { hasIntelligence } from "@/lib/ai/briefGuards";
import { recordActivity } from "@/lib/repo/activities";
import { refreshOpportunity } from "@/lib/ai/agent";
import {
  computeTotals,
  effectiveStatus,
  endOfTerm,
  formatMoney,
  getQuote,
  insertQuote,
  listQuotesForLead,
  newQuoteId,
  patchQuote,
  type QuoteLineItem,
  type QuoteMeta,
  type QuoteStatus,
} from "@/lib/repo/quotes";
import { reviewQuote } from "@/lib/quotes/review";
import { draftQuoteNarrative, type QuoteNarrative } from "@/lib/ai/narrative";
import { getWorkspaceData } from "@/lib/repo/workspace";
import { approvalChainFor, chainComplete, pendingStep, uncoveredRequirements } from "@/lib/quotes/rules";
import { canApproveQuotes, canAccessContract } from "@/lib/roles";

/**
 * Quote server actions. Every one is a POST whether or not a button was
 * rendered, so the rules live here: an approval-required quote cannot be sent
 * until a manager approves it, only drafts are editable, and every change is
 * appended to the quote's own history and echoed on the timeline.
 */
export interface QuoteActionResult {
  ok: boolean;
  detail: string;
  activityId?: string;
}

async function actor() {
  const u = await getCurrentUser();
  // "approver" is the gate that matters here: a manager or an admin. `role` is
  // kept as well, because the approval chain distinguishes the two.
  return { name: u?.name ?? null, admin: canApproveQuotes(u?.role), isAdmin: canAccessContract(u?.role), role: u?.role ?? null };
}

function revalidate(leadId: string) {
  revalidatePath(`/leads/${leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");
  revalidatePath("/tasks");
}

function parseItems(formData: FormData): QuoteLineItem[] {
  const out: QuoteLineItem[] = [];
  for (let i = 0; i < 20; i++) {
    const d = String(formData.get(`item_${i}_description`) ?? "").trim();
    if (!d) continue;
    const quantity = Number(formData.get(`item_${i}_quantity`) ?? 1);
    const unit_price = Number(formData.get(`item_${i}_unit_price`) ?? 0);
    const discount_pct = Number(formData.get(`item_${i}_discount_pct`) ?? 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(unit_price) || !Number.isFinite(discount_pct)) continue;
    out.push({ description: d, quantity: Math.max(0, quantity), unit_price: Math.max(0, unit_price), discount_pct: Math.min(100, Math.max(0, discount_pct)) });
  }
  return out;
}

/* The header fields are all optional, so each parser answers "nothing entered"
 * rather than guessing a default that would quietly change the arithmetic. */
function pct(v: FormDataEntryValue | null) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.min(100, n) : 0;
}

function positiveInt(v: FormDataEntryValue | null) {
  const n = Number(String(v ?? "").trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

function amountOrNull(v: FormDataEntryValue | null) {
  const n = Number(String(v ?? "").trim().replace(/[$,]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function dateOrNull(v: FormDataEntryValue | null) {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

async function buildMeta(leadId: string, formData: FormData, version: number, createdBy: string, quoteId: string): Promise<QuoteMeta | { error: string }> {
  const lead = await getLeadById(leadId);
  if (!lead) return { error: "Opportunity not found." };
  const items = parseItems(formData);
  if (!items.length) return { error: "Add at least one line item." };
  const validUntil = String(formData.get("valid_until") ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(validUntil)) return { error: "Choose a validity date." };
  const brief = await getLatestBrief(leadId);
  const intel = hasIntelligence(brief) ? brief.intelligence : null;

  // The commercial shape of the deal, which applies across every line.
  const adjustments = {
    additional_discount_pct: pct(formData.get("additional_discount_pct")),
    tax_pct: pct(formData.get("tax_pct")),
  };
  const start_date = dateOrNull(formData.get("start_date"));
  const term_months = positiveInt(formData.get("term_months"));
  const end_date = start_date && term_months ? endOfTerm(start_date, term_months) : null;
  const target_amount = amountOrNull(formData.get("target_amount"));

  const totals = computeTotals(items, adjustments);
  const review = reviewQuote({ items, validUntil, lead, intelligence: intel, adjustments });
  const approvals = approvalChainFor({ items, lead, intelligence: intel, adjustments });
  const not_covered = uncoveredRequirements({ items, lead, intelligence: intel });
  const now = new Date().toISOString();
  return {
    kind: "quote",
    quote_id: quoteId,
    version,
    status: "draft",
    currency: "USD",
    line_items: items,
    ...totals,
    ...adjustments,
    start_date,
    term_months,
    end_date,
    target_amount,
    terms: String(formData.get("terms") ?? "").trim() || null,
    valid_until: validUntil,
    notes: String(formData.get("notes") ?? "").trim() || null,
    review: { ...review, needs_approval: review.needs_approval || approvals.length > 0 },
    approvals,
    not_covered,
    // Editing answers the request, so the note stops being outstanding.
    changes_requested: null,
    superseded: false,
    history: [{ status: "created", at: now, by: createdBy }],
    created_by: createdBy,
  };
}

/** Create v1, or the next version if one exists. */
export async function createQuoteAction(leadId: string, formData: FormData): Promise<QuoteActionResult> {
  const { name } = await actor();
  if (!name) return { ok: false, detail: "Sign in first." };
  const existing = await listQuotesForLead(leadId);
  const version = (existing[0]?.meta.version ?? 0) + 1;
  const meta = await buildMeta(leadId, formData, version, name, newQuoteId());
  if ("error" in meta) return { ok: false, detail: meta.error };

  // A new version retires the one before it.
  for (const q of existing.filter((q) => !q.meta.superseded)) await patchQuote(q.activityId, { superseded: true });
  const row = await insertQuote(leadId, meta, name);
  await afterChange(leadId, name);
  return { ok: true, detail: `Quote v${version} created${meta.review.needs_approval ? " — needs approval before it can be sent." : "."}`, activityId: row.activityId };
}

/** Edit a draft in place. Sent quotes are recalled first, then edited as a new version. */
export async function updateDraftAction(activityId: string, formData: FormData): Promise<QuoteActionResult> {
  const { name } = await actor();
  if (!name) return { ok: false, detail: "Sign in first." };
  const q = await getQuote(activityId);
  if (!q) return { ok: false, detail: "Quote not found." };
  if (q.meta.status !== "draft") return { ok: false, detail: "Only a draft can be edited. Recall a sent quote, or clone a new version." };
  const meta = await buildMeta(q.leadId, formData, q.meta.version, q.meta.created_by, q.meta.quote_id);
  if ("error" in meta) return { ok: false, detail: meta.error };
  await patchQuote(activityId, { ...meta, status: "draft", history: [...q.meta.history, { status: "edited", at: new Date().toISOString(), by: name }] });
  revalidate(q.leadId);
  return { ok: true, detail: "Draft updated." };
}

/** Copy the active version into a new draft — the customer asked for changes. */
export async function cloneVersionAction(activityId: string): Promise<QuoteActionResult> {
  const { name } = await actor();
  if (!name) return { ok: false, detail: "Sign in first." };
  const q = await getQuote(activityId);
  if (!q) return { ok: false, detail: "Quote not found." };
  const all = await listQuotesForLead(q.leadId);
  const version = (all[0]?.meta.version ?? q.meta.version) + 1;
  // The version being replaced is marked re-quoted when the customer had
  // actually seen it — that is a negotiation step, not an edit.
  for (const o of all.filter((o) => !o.meta.superseded)) {
    const wasSeen = o.meta.history.some((h) => h.status === "sent");
    await patchQuote(o.activityId, { superseded: true, ...(wasSeen ? { status: "requoted" as const } : {}) });
  }
  const lead = await getLeadById(q.leadId);
  const brief = await getLatestBrief(q.leadId);
  const review = lead ? reviewQuote({ items: q.meta.line_items, validUntil: q.meta.valid_until, lead, intelligence: hasIntelligence(brief) ? brief.intelligence : null }) : q.meta.review;
  const now = new Date().toISOString();
  const row = await insertQuote(
    q.leadId,
    { ...q.meta, quote_id: newQuoteId(), version, status: "draft", review, superseded: false, history: [{ status: "cloned", at: now, by: name, note: `from v${q.meta.version}` }], created_by: name },
    name
  );
  revalidate(q.leadId);
  return { ok: true, detail: `Quote v${version} drafted from v${q.meta.version}.`, activityId: row.activityId };
}

/** Manager approval — required when the review flagged commercial ground. */
export async function approveQuoteAction(activityId: string): Promise<QuoteActionResult> {
  const { name, admin, isAdmin } = await actor();
  if (!name) return { ok: false, detail: "Sign in first." };
  if (!admin) return { ok: false, detail: "Only a sales manager or an admin can approve a quote." };
  const q = await getQuote(activityId);
  if (!q) return { ok: false, detail: "Quote not found." };
  if (q.meta.status !== "draft") return { ok: false, detail: `A ${q.meta.status} quote cannot be approved.` };

  const chain = q.meta.approvals ?? [];
  const step = pendingStep(chain);
  if (!step) {
    // Nothing outstanding — approve it outright (a quote inside every rule).
    await transition(q.activityId, q.leadId, q.meta, "approved", name, `Quote v${q.meta.version} approved by ${name}.`);
    return { ok: true, detail: "Approved. It can now be sent." };
  }
  // Each link needs its own authority: a manager cannot sign the admin's step.
  if (step.role === "admin" && !isAdmin) {
    return { ok: false, detail: `This step needs an admin: ${step.reason}` };
  }

  const at = new Date().toISOString();
  const updated = chain.map((s) => (s === step ? { ...s, state: "approved" as const, by: name, at } : s));
  const done = chainComplete(updated);
  await patchQuote(q.activityId, {
    approvals: updated,
    ...(done ? { status: "approved" as const, history: [...q.meta.history, { status: "approved" as const, at, by: name }] } : {}),
  });
  await recordActivity({
    leadId: q.leadId,
    type: "note",
    body: `Quote v${q.meta.version} — ${step.role === "admin" ? "admin" : "manager"} approval given by ${name}.${done ? " Approval chain complete; it can now be sent." : ""}`,
    actorName: name,
    metadata: { kind: "quote_event", quote_activity_id: activityId, quote_id: q.meta.quote_id, version: q.meta.version, status: done ? "approved" : "draft", total: q.meta.total },
  });
  revalidate(q.leadId);
  const remaining = updated.filter((s) => s.state === "pending");
  return {
    ok: true,
    detail: done ? "Approved. It can now be sent." : `Recorded. Still waiting on ${remaining.map((s) => s.role).join(" and ")}.`,
  };
}

/**
 * The other half of an approval: send it back.
 *
 * An approver looking at a quote has two answers, not one — a deep discount is
 * often fine *if* the term is longer, and the useful reply is that sentence
 * rather than a silent refusal. Requesting changes leaves the quote a draft the
 * rep can edit, resets any approval already given on it (the numbers are about
 * to move, so a signature on the old ones means nothing), and puts the note
 * where the rep will see it, on the quote and on the timeline.
 */
export async function requestQuoteChangesAction(activityId: string, note: string): Promise<QuoteActionResult> {
  const { name, admin } = await actor();
  if (!name) return { ok: false, detail: "Sign in first." };
  if (!admin) return { ok: false, detail: "Only a sales manager or an admin can ask for changes to a quote." };
  const text = note.trim();
  if (!text) return { ok: false, detail: "Say what needs to change." };
  const q = await getQuote(activityId);
  if (!q) return { ok: false, detail: "Quote not found." };
  if (q.meta.status !== "draft" && q.meta.status !== "approved") return { ok: false, detail: `A ${q.meta.status} quote is already with the customer — clone a new version instead.` };

  const at = new Date().toISOString();
  await patchQuote(activityId, {
    status: "draft",
    approvals: (q.meta.approvals ?? []).map((s) => ({ ...s, state: "pending" as const, by: undefined, at: undefined })),
    changes_requested: { by: name, at, note: text },
    history: [...q.meta.history, { status: "edited" as const, at, by: name, note: `changes requested: ${text}` }],
  });
  await recordActivity({
    leadId: q.leadId,
    type: "note",
    body: `Quote v${q.meta.version} — ${name} asked for changes: ${text}`,
    actorName: name,
    metadata: { kind: "quote_event", quote_activity_id: activityId, quote_id: q.meta.quote_id, version: q.meta.version, status: "draft", total: q.meta.total },
  });
  revalidate(q.leadId);
  return { ok: true, detail: "Sent back to the owner with your note." };
}

/**
 * Send to the customer. Recorded on the timeline; delivery itself is the
 * salesperson's email client for now.
 *
 * A rep builds the quote; an admin releases it. That split is the standard one
 * in CPQ, and it is enforced here rather than only in the button: the action is
 * a network endpoint, so hiding the control is a nicety and this check is the
 * actual rule.
 */
export async function sendQuoteAction(activityId: string): Promise<QuoteActionResult> {
  const { name, admin } = await actor();
  if (!name) return { ok: false, detail: "Sign in first." };
  if (!admin) return { ok: false, detail: "Only a sales manager or an admin can send a quote to a customer." };
  const q = await getQuote(activityId);
  if (!q) return { ok: false, detail: "Quote not found." };
  const status = effectiveStatus(q.meta);
  if (status === "expired") return { ok: false, detail: "This quote has expired — clone a new version with a fresh validity date." };
  if (!chainComplete(q.meta.approvals) && q.meta.status !== "approved") {
    const step = pendingStep(q.meta.approvals);
    return { ok: false, detail: step ? `Waiting on ${step.role === "admin" ? "an admin" : "a manager"}: ${step.reason}` : "This quote needs approval before it can be sent." };
  }
  if (q.meta.review.needs_approval && !chainComplete(q.meta.approvals) && q.meta.status !== "approved") return { ok: false, detail: "This quote needs approval before it can be sent." };
  if (!["draft", "approved", "recalled", "negotiating"].includes(q.meta.status)) return { ok: false, detail: `A ${q.meta.status} quote cannot be sent again.` };
  await transition(q.activityId, q.leadId, q.meta, "sent", name, `Quote v${q.meta.version} sent to the customer — ${formatMoney(q.meta.total)}, valid until ${q.meta.valid_until}.`);
  return { ok: true, detail: "Marked as sent and logged on the timeline." };
}

/** The counterpart to sending, so it sits with the same person. */
export async function recallQuoteAction(activityId: string): Promise<QuoteActionResult> {
  const { name, admin } = await actor();
  if (!name) return { ok: false, detail: "Sign in first." };
  if (!admin) return { ok: false, detail: "Only a sales manager or an admin can recall a quote." };
  const q = await getQuote(activityId);
  if (!q) return { ok: false, detail: "Quote not found." };
  if (q.meta.status !== "sent" && q.meta.status !== "viewed") return { ok: false, detail: "Only a sent quote can be recalled." };
  await transition(q.activityId, q.leadId, q.meta, "recalled", name, `Quote v${q.meta.version} recalled.`);
  return { ok: true, detail: "Recalled. Clone a new version to make changes." };
}

/** The customer opened it / said yes — recorded by the salesperson who heard it. */
export async function markQuoteAction(activityId: string, status: "viewed" | "accepted"): Promise<QuoteActionResult> {
  const { name } = await actor();
  if (!name) return { ok: false, detail: "Sign in first." };
  const q = await getQuote(activityId);
  if (!q) return { ok: false, detail: "Quote not found." };
  if (status === "viewed" && q.meta.status !== "sent") return { ok: false, detail: "Only a sent quote can be marked as viewed." };
  if (status === "accepted" && q.meta.status !== "sent" && q.meta.status !== "viewed") return { ok: false, detail: "Only a sent quote can be accepted." };
  await transition(q.activityId, q.leadId, q.meta, status, name, status === "accepted" ? `Customer accepted quote v${q.meta.version} — ${formatMoney(q.meta.total)}.` : `Customer viewed quote v${q.meta.version}.`);
  if (status === "accepted") await afterChange(q.leadId, name);
  return { ok: true, detail: status === "accepted" ? "Accepted. The agent will recommend the next step." : "Marked as viewed." };
}

/* ----------------------------------------------------------------- helpers */

async function transition(activityId: string, leadId: string, meta: QuoteMeta, status: QuoteStatus, by: string, body: string) {
  const at = new Date().toISOString();
  await patchQuote(activityId, { status, history: [...meta.history, { status, at, by }] });
  await recordActivity({ leadId, type: "note", body, actorName: by, metadata: { kind: "quote_event", quote_activity_id: activityId, quote_id: meta.quote_id, version: meta.version, status, total: meta.total } });
  revalidate(leadId);
}

/** Quotes change what the agent should propose next, so the loop runs again. */
async function afterChange(leadId: string, actorName: string) {
  try {
    await refreshOpportunity(leadId, { actorName });
  } catch (err) {
    console.error("Refresh after quote change failed (non-fatal):", err);
  }
  revalidate(leadId);
}

/**
 * Draft the note that goes out with the quote.
 *
 * Called from the line editor while the rep is still typing, so it reads the
 * lines from the form rather than from a saved quote — the whole point is to
 * have the narrative before the quote exists, not after. Nothing is written
 * here and nothing is sent: the draft comes back as text the rep edits and
 * decides on.
 */
export async function draftNarrativeAction(leadId: string, formData: FormData): Promise<{ ok: boolean; detail: string; narrative?: QuoteNarrative }> {
  const { name } = await actor();
  if (!name) return { ok: false, detail: "Sign in first." };
  const data = await getWorkspaceData(leadId);
  if (!data) return { ok: false, detail: "Opportunity not found." };
  const items = parseItems(formData);
  if (!items.length) return { ok: false, detail: "Add a line item first — the note describes what is on the quote." };

  const brief = await getLatestBrief(leadId);
  const intel = hasIntelligence(brief) ? brief.intelligence : null;
  const existing = await listQuotesForLead(leadId);
  const narrative = await draftQuoteNarrative({
    lead: data.lead,
    company: data.company,
    contact: data.contacts.find((c) => c.is_primary) ?? data.contacts[0] ?? null,
    intelligence: intel,
    items,
    notCovered: uncoveredRequirements({ items, lead: data.lead, intelligence: intel }),
    version: (existing[0]?.meta.version ?? 0) + 1,
  });
  return { ok: true, detail: narrative.reason ?? "Drafted from the record.", narrative };
}
