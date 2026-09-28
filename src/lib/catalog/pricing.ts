import { computeTotals, type QuoteAdjustments, type QuoteLineItem } from "@/lib/quotes/math";
import { getProduct, lineDescription, PRICE_LIST, type Product } from "@/lib/catalog/catalog";

/**
 * Deterministic pricing: the only place a quote line gets a price from the
 * catalog, and the only place a discount request is judged.
 *
 * The model may *propose* products and a discount; it never computes money.
 * Every number here is `quantity × current list price − approved discount +
 * tax`, done by `computeTotals`, the same function the quote editor and the
 * saved quote use.
 */

export interface DiscountRulesInput {
  managerPct: number;
  adminPct: number;
}

export interface DiscountCheck {
  product: string | null;
  requested_pct: number;
  /** ok = the rep may give it; manager/admin = that approval is required first. */
  level: "ok" | "manager" | "admin";
  reason: string;
}

export function validateDiscount(productCode: string | null, requestedPct: number, rules: DiscountRulesInput): DiscountCheck {
  const pct = Math.max(0, Math.min(100, Number.isFinite(requestedPct) ? requestedPct : 0));
  const p = productCode ? getProduct(productCode) : null;
  if (p && pct > p.max_discount_pct) {
    return { product: p.code, requested_pct: pct, level: "admin", reason: `${pct}% is above ${p.name}'s ${p.max_discount_pct}% ceiling on the price list — admin approval required.` };
  }
  if (pct > rules.adminPct) return { product: p?.code ?? null, requested_pct: pct, level: "admin", reason: `${pct}% is above the ${rules.adminPct}% admin threshold.` };
  if (pct > rules.managerPct) return { product: p?.code ?? null, requested_pct: pct, level: "manager", reason: `${pct}% is above the ${rules.managerPct}% a rep may give alone — manager approval required.` };
  return { product: p?.code ?? null, requested_pct: pct, level: "ok", reason: pct > 0 ? `${pct}% is within what a rep may give.` : "No discount requested." };
}

export interface PriceRequestLine {
  product_code: string;
  quantity: number;
  discount_pct?: number;
}

export interface PricedQuote {
  price_list: typeof PRICE_LIST;
  lines: (QuoteLineItem & { product_code: string; list_price: number; unit: Product["unit"]; discount_check: DiscountCheck })[];
  unknown_products: string[];
  totals: ReturnType<typeof computeTotals>;
  /** The strictest approval any line or the overall discount calls for. */
  approval: "ok" | "manager" | "admin";
  approval_reasons: string[];
}

/** Price a set of product lines from the catalog. Unknown codes are reported, never priced. */
export function calculateQuote(lines: PriceRequestLine[], rules: DiscountRulesInput, adjustments?: QuoteAdjustments): PricedQuote {
  const out: PricedQuote["lines"] = [];
  const unknown: string[] = [];
  for (const l of lines) {
    const p = getProduct(l.product_code);
    if (!p) {
      unknown.push(l.product_code);
      continue;
    }
    // A platform product is one subscription whatever quantity was asked for.
    const quantity = p.unit === "platform" ? 1 : Math.max(0, Math.round(Number(l.quantity) || 0));
    const check = validateDiscount(p.code, l.discount_pct ?? 0, rules);
    out.push({ description: lineDescription(p), quantity, unit_price: p.list_price, discount_pct: check.requested_pct, product_code: p.code, list_price: p.list_price, unit: p.unit, discount_check: check });
  }
  const totals = computeTotals(out, adjustments);
  const overall = validateDiscount(null, totals.discount_pct, rules);
  const checks = [...out.map((l) => l.discount_check), overall];
  const rank = { ok: 0, manager: 1, admin: 2 } as const;
  const approval = checks.reduce<"ok" | "manager" | "admin">((w, c) => (rank[c.level] > rank[w] ? c.level : w), "ok");
  const reasons = [...new Set(checks.filter((c) => c.level !== "ok").map((c) => c.reason))];
  return { price_list: PRICE_LIST, lines: out, unknown_products: unknown, totals, approval, approval_reasons: reasons };
}
