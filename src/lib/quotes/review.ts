import type { Lead } from "@/lib/types";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";
import type { QuoteReview } from "@/lib/repo/quotes";
import { computeTotals, type QuoteAdjustments, type QuoteLineItem } from "@/lib/quotes/math";

/**
 * The quote check.
 *
 * Deterministic, and deliberately small: there are no pricing rules in this
 * product to encode, so the review does not invent any. It checks the quote a
 * person entered against the two things the record actually knows — the
 * discount threshold this deployment set, and what the customer and the
 * qualification already said — and names each problem in one sentence. A
 * quote that trips the discount threshold or exceeds a stated budget needs an
 * admin's approval before it can go to the customer.
 */
export function discountApprovalThreshold(): number {
  const raw = Number(process.env.QUOTE_DISCOUNT_APPROVAL_PCT);
  return Number.isFinite(raw) && raw > 0 ? raw : 15;
}

export function reviewQuote(args: {
  items: QuoteLineItem[];
  validUntil: string;
  lead: Lead;
  intelligence: OpportunityIntelligence | null;
  adjustments?: QuoteAdjustments;
  now?: Date;
}): QuoteReview {
  const now = args.now ?? new Date();
  const totals = computeTotals(args.items, args.adjustments);
  const issues: string[] = [];
  let needsApproval = false;

  if (args.items.length === 0 || totals.subtotal <= 0) issues.push("The quote has no priced line items.");

  const threshold = discountApprovalThreshold();
  if (totals.discount_pct > threshold) {
    issues.push(`Discount ${totals.discount_pct}% exceeds the ${threshold}% approval threshold.`);
    needsApproval = true;
  }

  // The customer's own stated budget, when it carries a figure we can read.
  const budget = parseBudget(args.lead.qualification?.budget ?? null);
  if (budget && totals.total > budget.amount) {
    issues.push(`Total ${money(totals.total)} exceeds the customer's stated budget context (${args.lead.qualification?.budget}).`);
    needsApproval = true;
  }

  const readiness = args.intelligence?.readiness;
  if (readiness && !readiness.ready && readiness.blocking.length) {
    issues.push(`Qualification incomplete: ${readiness.blocking.slice(0, 2).join(", ")}${readiness.blocking.length > 2 ? ` +${readiness.blocking.length - 2}` : ""}.`);
  }

  if (!args.validUntil || new Date(`${args.validUntil}T23:59:59`) < now) issues.push("The validity date is missing or already past.");

  return { ok: issues.length === 0, issues, needs_approval: needsApproval, checked_at: now.toISOString() };
}

/** "$15k/year" → 15000; "Around $1k per month" → 12000; "$12k/year approved" → 12000. Anything without a figure → null. */
export function parseBudget(text: string | null): { amount: number; per: "year" | "month" | null } | null {
  if (!text) return null;
  const m = text.match(/\$?\s*(\d[\d,]*(?:\.\d+)?)\s*(k|m)?\b/i);
  if (!m) return null;
  let amount = Number(m[1].replace(/,/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  if (m[2]?.toLowerCase() === "k") amount *= 1_000;
  if (m[2]?.toLowerCase() === "m") amount *= 1_000_000;
  const monthly = /\b(per|a|\/)\s*month\b|\/mo\b|monthly/i.test(text);
  return { amount: monthly ? amount * 12 : amount, per: monthly ? "month" : /year|annual|\/yr/i.test(text) ? "year" : null };
}

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
