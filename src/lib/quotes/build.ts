import { getLeadById } from "@/lib/repo/leads";
import { getLatestBrief } from "@/lib/repo/aiBriefs";
import { hasIntelligence } from "@/lib/ai/briefGuards";
import { computeTotals, endOfTerm, type QuoteLineItem, type QuoteMeta } from "@/lib/repo/quotes";
import { reviewQuote } from "@/lib/quotes/review";
import { approvalChainFor, uncoveredRequirements } from "@/lib/quotes/rules";

/**
 * Building a quote record from the editor's fields.
 *
 * Kept out of the server-actions file so the agent's create_quote_draft tool
 * builds a draft through exactly the same path a rep's form submit does — the
 * same review, the same approval chain, the same arithmetic.
 */
export function parseItems(formData: FormData): QuoteLineItem[] {
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

export async function buildMeta(leadId: string, formData: FormData, version: number, createdBy: string, quoteId: string): Promise<QuoteMeta | { error: string }> {
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

