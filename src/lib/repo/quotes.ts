import { randomUUID } from "node:crypto";
import { query } from "@/lib/db";
import { recordActivity } from "@/lib/repo/activities";
import { patchActivityMetadata } from "@/lib/repo/agentActions";
import { round, type QuoteAdjustments, type QuoteLineItem } from "@/lib/quotes/math";

// The arithmetic lives in `@/lib/quotes/math` so the browser can import it
// without dragging the database in; re-exported here so every existing caller
// of `@/lib/repo/quotes` keeps working unchanged.
export { computeTotals, lineNet, netUnitPrice, endOfTerm } from "@/lib/quotes/math";
export type { QuoteLineItem, QuoteAdjustments } from "@/lib/quotes/math";

/**
 * Quotes, on the timeline.
 *
 * A quote is the commercial proposal a salesperson puts in front of the
 * customer: line items, a discount, terms, a validity date. It lives where
 * everything else on an opportunity lives — an `activities` row with
 * `metadata.kind = "quote"` — for the same reason agent actions and booked
 * calls do: the timeline is the record of what happened to a deal, and
 * "quote v2 sent to Dana" is exactly that. No new table.
 *
 * Versions are separate rows sharing nothing but the lead. Cloning a version
 * writes the next one and marks the old one superseded; the active quote is the
 * newest version that hasn't been superseded. Every state change is appended
 * to `history`, so the story of a quote is readable without another table.
 *
 * Amounts are entered by a person. Nothing here computes a price from a rule,
 * because there are no pricing rules in this product — the review below only
 * checks what was entered against thresholds and the record.
 */
export const QUOTE_KIND = "quote";

/**
 * The life of a quote, in the order it happens:
 *
 *   draft → approved → sent → viewed → negotiating → requoted → accepted
 *
 * `negotiating` is the customer pushing back on a quote they have — the deal is
 * alive and the conversation is about terms, which is a different thing from
 * silence. `requoted` marks a version that has been replaced by a newer one
 * written in answer to that pushback, so the history reads as a negotiation
 * rather than a list of edits. Both live entirely in the metadata: no migration.
 */
export type QuoteStatus = "draft" | "approved" | "sent" | "viewed" | "negotiating" | "requoted" | "accepted" | "recalled" | "expired";

export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: "Draft",
  approved: "Approved",
  sent: "Sent",
  viewed: "Viewed",
  negotiating: "Negotiating",
  requoted: "Re-quoted",
  accepted: "Accepted",
  recalled: "Recalled",
  expired: "Expired",
};

/** The stages shown as a progress line on the quote, in order. */
export const QUOTE_FLOW: QuoteStatus[] = ["draft", "approved", "sent", "negotiating", "requoted", "accepted"];

export interface QuoteReview {
  ok: boolean;
  /** Plain-language issues, each one a fact about the quote or the record. */
  issues: string[];
  /** Whether someone with authority must approve before this can go to the customer. */
  needs_approval: boolean;
  checked_at: string;
}

/**
 * One link in the approval chain.
 *
 * A chain rather than a single flag because the authority needed depends on how
 * far the quote goes: a small discount is a manager's call, a deep one is the
 * admin's as well. Steps are satisfied in order, and a quote can only be sent
 * once every step is approved.
 */
export interface QuoteApprovalStep {
  /** Who has to sign this one off. */
  role: "manager" | "admin";
  /** Why this step exists, in the words the reviewer needs. */
  reason: string;
  state: "pending" | "approved";
  by?: string;
  at?: string;
}

export interface QuoteMeta extends QuoteAdjustments {
  kind: typeof QUOTE_KIND;
  quote_id: string;
  version: number;
  status: QuoteStatus;
  currency: string;
  line_items: QuoteLineItem[];
  subtotal: number;
  discount_total: number;
  total: number;
  /** Overall discount as a share of the subtotal, percent. */
  discount_pct: number;
  /** Discount given on the lines themselves, before the header-level one. */
  line_discount_total?: number;
  /** Discount given on the whole quote, after the lines. */
  additional_discount_total?: number;
  /** Subtotal less every discount, before tax. */
  net_amount?: number;
  tax_total?: number;
  /** When the subscription starts, and for how long. */
  start_date?: string | null; // YYYY-MM-DD
  term_months?: number | null;
  end_date?: string | null; // YYYY-MM-DD, derived from the two above
  /** What the customer said they wanted to land on, for the rep to aim at. */
  target_amount?: number | null;
  terms: string | null;
  valid_until: string; // YYYY-MM-DD
  notes: string | null;
  review: QuoteReview;
  /** Who still has to sign this off before it can be sent. Empty = nobody. */
  approvals?: QuoteApprovalStep[];
  /**
   * What the customer asked for that this quote does *not* price. A partial
   * quote is a legitimate, common thing — three of the four things they asked
   * about — but it should be visible rather than discovered by the customer.
   */
  not_covered?: string[];
  /** An approver sent it back rather than signing it, and what they said. */
  changes_requested?: { by: string; at: string; note: string } | null;
  superseded: boolean;
  history: { status: QuoteStatus | "created" | "edited" | "cloned"; at: string; by: string; note?: string }[];
  created_by: string;
}

export interface QuoteRow {
  activityId: string;
  leadId: string;
  createdAt: string;
  meta: QuoteMeta;
}

export interface QuoteListRow extends QuoteRow {
  companyName: string;
  ownerName: string | null;
  leadStatus: string;
}

function toMeta(raw: unknown): QuoteMeta | null {
  const m = raw as QuoteMeta | undefined;
  return m && m.kind === QUOTE_KIND && m.quote_id ? m : null;
}

/** A quote past its validity date that never closed reads as expired, without a job to flip it. */
export function effectiveStatus(m: QuoteMeta, now = new Date()): QuoteStatus {
  if (m.status === "accepted" || m.status === "recalled" || m.status === "expired" || m.status === "requoted") return m.status;
  if (m.valid_until && new Date(`${m.valid_until}T23:59:59`) < now) return "expired";
  return m.status;
}

/* ------------------------------------------------------------------ writes */

export async function insertQuote(leadId: string, meta: QuoteMeta, actorName: string): Promise<QuoteRow> {
  const a = await recordActivity({
    leadId,
    type: "note",
    body: `Quote v${meta.version} created — ${formatMoney(meta.total, meta.currency)}, valid until ${meta.valid_until}.`,
    actorName,
    metadata: meta as unknown as Record<string, unknown>,
  });
  return { activityId: a.id, leadId, createdAt: a.occurred_at, meta };
}

export async function patchQuote(activityId: string, patch: Partial<QuoteMeta>) {
  await patchActivityMetadata(activityId, patch as Record<string, unknown>);
}

export function newQuoteId() {
  return randomUUID();
}

/* ------------------------------------------------------------------- reads */

export async function listQuotesForLead(leadId: string): Promise<QuoteRow[]> {
  const rows = await query<{ id: string; lead_id: string; occurred_at: string; metadata: unknown }>(
    `select id, lead_id, occurred_at, metadata from activities
      where lead_id = $1 and metadata->>'kind' = $2
      order by (metadata->>'version')::int desc`,
    [leadId, QUOTE_KIND]
  );
  return rows
    .map((r) => {
      const meta = toMeta(r.metadata);
      return meta ? { activityId: r.id, leadId: r.lead_id, createdAt: iso(r.occurred_at), meta } : null;
    })
    .filter((r): r is QuoteRow => Boolean(r));
}

export async function getQuote(activityId: string): Promise<QuoteRow | null> {
  const rows = await query<{ id: string; lead_id: string; occurred_at: string; metadata: unknown }>(`select id, lead_id, occurred_at, metadata from activities where id = $1`, [activityId]);
  if (!rows.length) return null;
  const meta = toMeta(rows[0].metadata);
  return meta ? { activityId: rows[0].id, leadId: rows[0].lead_id, createdAt: iso(rows[0].occurred_at), meta } : null;
}

/** The version the customer is (or will be) looking at. */
export function activeQuote(quotes: QuoteRow[]): QuoteRow | null {
  return quotes.find((q) => !q.meta.superseded) ?? quotes[0] ?? null;
}

/** Every quote on an open opportunity — what Home and Scheduled Tasks count. */
export async function listOpenQuotes(limit = 300): Promise<QuoteListRow[]> {
  const rows = await query<{ id: string; lead_id: string; occurred_at: string; metadata: unknown; company_name: string; owner_name: string | null; lead_status: string }>(
    `select a.id, a.lead_id, a.occurred_at, a.metadata, c.name as company_name, u.name as owner_name, l.status as lead_status
       from activities a
       join leads l on l.id = a.lead_id
       join companies c on c.id = l.company_id
       left join app_users u on u.id = l.owner_user_id
      where a.metadata->>'kind' = $1
      order by a.occurred_at desc
      limit $2`,
    [QUOTE_KIND, limit]
  );
  return rows
    .map((r) => {
      const meta = toMeta(r.metadata);
      return meta ? { activityId: r.id, leadId: r.lead_id, createdAt: iso(r.occurred_at), meta, companyName: r.company_name, ownerName: r.owner_name, leadStatus: r.lead_status } : null;
    })
    .filter((r): r is QuoteListRow => Boolean(r));
}

export function formatMoney(n: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: n % 1 === 0 ? 0 : 2 }).format(n);
}

function iso(v: unknown) {
  return v instanceof Date ? v.toISOString() : String(v);
}

/* --------------------------------------------------- what changed, and what isn't covered */

export interface QuoteDiff {
  /** Lines in the new version that were not in the old one. */
  added: QuoteLineItem[];
  /** Lines in the old version that are gone. */
  removed: QuoteLineItem[];
  /** Lines present in both, where something about them moved. */
  changed: { description: string; field: "quantity" | "unit price" | "discount"; from: string; to: string }[];
  /** Money delta, new minus old. */
  totalDelta: number;
  discountDelta: number;
  validityChanged: { from: string; to: string } | null;
  termsChanged: boolean;
}

/**
 * What changed between two versions of a quote.
 *
 * The question a customer asks about a re-quote is never "what is in it" — they
 * have the old one in front of them — it is "what did you change". Lines are
 * matched on their description, which is what a person actually renames a line
 * to when they mean a different thing, and every difference is expressed as a
 * before and an after rather than a percentage.
 */
export function diffQuotes(previous: QuoteMeta, next: QuoteMeta): QuoteDiff {
  const key = (i: QuoteLineItem) => i.description.trim().toLowerCase();
  const before = new Map(previous.line_items.map((i) => [key(i), i]));
  const after = new Map(next.line_items.map((i) => [key(i), i]));

  const added = next.line_items.filter((i) => !before.has(key(i)));
  const removed = previous.line_items.filter((i) => !after.has(key(i)));
  const changed: QuoteDiff["changed"] = [];
  for (const [k, now] of after) {
    const was = before.get(k);
    if (!was) continue;
    if (was.quantity !== now.quantity) changed.push({ description: now.description, field: "quantity", from: String(was.quantity), to: String(now.quantity) });
    if (was.unit_price !== now.unit_price) changed.push({ description: now.description, field: "unit price", from: formatMoney(was.unit_price), to: formatMoney(now.unit_price) });
    if (was.discount_pct !== now.discount_pct) changed.push({ description: now.description, field: "discount", from: `${was.discount_pct}%`, to: `${now.discount_pct}%` });
  }

  return {
    added,
    removed,
    changed,
    totalDelta: round(next.total - previous.total),
    discountDelta: round(next.discount_pct - previous.discount_pct),
    validityChanged: previous.valid_until !== next.valid_until ? { from: previous.valid_until, to: next.valid_until } : null,
    termsChanged: (previous.terms ?? "") !== (next.terms ?? ""),
  };
}

/** True when nothing about the commercial substance moved. */
export function isEmptyDiff(d: QuoteDiff): boolean {
  return d.added.length === 0 && d.removed.length === 0 && d.changed.length === 0 && d.totalDelta === 0 && !d.validityChanged && !d.termsChanged;
}

/** The version immediately below this one, for a "what changed" comparison. */
export function previousVersion(quotes: QuoteRow[], version: number): QuoteRow | null {
  return quotes.filter((q) => q.meta.version < version).sort((a, b) => b.meta.version - a.meta.version)[0] ?? null;
}
