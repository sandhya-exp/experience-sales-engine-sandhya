/**
 * Quote arithmetic, with no database in it.
 *
 * This lives apart from `@/lib/repo/quotes` for one reason: the line editor
 * runs in the browser and has to total the quote as the rep types, and the repo
 * module reaches for `pg` the moment it is imported. The numbers a customer
 * sees must be the same numbers the server stores, so both sides import these
 * functions rather than each keeping their own copy — the earlier editor
 * recalculated totals inline, and a formula written twice is a formula that
 * will eventually disagree with itself.
 */

export interface QuoteLineItem {
  description: string;
  quantity: number;
  unit_price: number;
  /** Line-level discount, percent. */
  discount_pct: number;
}

/**
 * The commercial shape of the quote, as opposed to its lines.
 *
 * A subscription quote is not only a list of things at prices: it sometimes
 * carries a discount negotiated on the whole deal rather than line by line, and
 * sometimes tax on top. Both are optional — a quote with neither totals exactly
 * as it always did.
 */
export interface QuoteAdjustments {
  /** Discount applied to the whole quote, after line discounts. Percent. */
  additional_discount_pct?: number;
  /** Tax applied to the net amount. Percent. */
  tax_pct?: number;
}

/**
 * What the quote adds up to.
 *
 * Money moves in one direction through four stops, and the editor shows all
 * four because a customer asking "where did that number come from" is asking
 * about exactly this chain:
 *
 *   subtotal  →  less line discounts  →  less the whole-quote discount
 *             →  net amount  →  plus tax  →  quote total
 *
 * `discount_pct` is the effective discount against the list subtotal, which is
 * the number the approval rules read: it is what the business actually gave
 * away, whether that was given line by line or in one stroke at the end.
 */
export function computeTotals(items: QuoteLineItem[], adjustments?: QuoteAdjustments) {
  const subtotal = round(items.reduce((s, i) => s + i.quantity * i.unit_price, 0));
  const line_discount_total = round(items.reduce((s, i) => s + i.quantity * i.unit_price * (i.discount_pct / 100), 0));
  const afterLines = round(subtotal - line_discount_total);

  const addlPct = clamp(adjustments?.additional_discount_pct ?? 0, 0, 100);
  const additional_discount_total = round(afterLines * (addlPct / 100));

  const discount_total = round(line_discount_total + additional_discount_total);
  const net_amount = round(subtotal - discount_total);

  const taxPct = clamp(adjustments?.tax_pct ?? 0, 0, 100);
  const tax_total = round(net_amount * (taxPct / 100));
  const total = round(net_amount + tax_total);

  const discount_pct = subtotal > 0 ? round((discount_total / subtotal) * 100) : 0;
  return { subtotal, line_discount_total, additional_discount_total, discount_total, discount_pct, net_amount, tax_total, total };
}

/** What one line is worth after its own discount. */
export function lineNet(item: QuoteLineItem) {
  return round(item.quantity * item.unit_price * (1 - item.discount_pct / 100));
}

/** The unit price actually being charged on a line, after its discount. */
export function netUnitPrice(item: QuoteLineItem) {
  return round(item.unit_price * (1 - item.discount_pct / 100));
}

/**
 * The last day of a term that starts on `start` and runs `months`.
 *
 * A 12-month term starting 1 March ends 28 February, not 1 March — the end date
 * a customer signs is the last day they are covered.
 */
export function endOfTerm(start: string, months: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(months) || months <= 0) return null;
  const d = new Date(`${start}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + Math.round(months));
  // A term starting on the 31st must not roll into the month after a short one.
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export function round(n: number) {
  return Math.round(n * 100) / 100;
}

function clamp(n: number, lo: number, hi: number) {
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo;
}
