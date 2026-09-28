import { queryOne } from "@/lib/db";
import type { Company } from "@/lib/types";
import { getLeadById } from "@/lib/repo/leads";
import { listContactsForCompany } from "@/lib/repo/contacts";
import { listActivitiesForLead, recordActivity } from "@/lib/repo/activities";
import { getLatestBrief } from "@/lib/repo/aiBriefs";
import { hasIntelligence } from "@/lib/ai/briefGuards";
import { qualificationView } from "@/lib/ai/tools";
import { currentContract, dealHistoryForCompany, findCompanyByName, recentDeals, type DealHistoryRow, type DealType } from "@/lib/repo/salesHistory";
import { getProduct, getProducts, PRICE_LIST, unitLabel } from "@/lib/catalog/catalog";
import { calculateQuote, validateDiscount, type PriceRequestLine } from "@/lib/catalog/pricing";
import { discountRules, uncoveredRequirements } from "@/lib/quotes/rules";
import { reviewQuote } from "@/lib/quotes/review";
import { draftQuoteNarrative } from "@/lib/ai/narrative";
import { scheduleFollowUp } from "@/lib/repo/followups";
import { insertQuote, listQuotesForLead, newQuoteId, patchQuote, formatMoney } from "@/lib/repo/quotes";
import { buildMeta } from "@/lib/quotes/build";
import { APPROVAL_REQUEST_KIND, type ApprovalRequestMeta } from "@/lib/repo/approvals";

/**
 * The Sales Engine tool registry — one controlled layer between the AI agent
 * and the business, exposed to the in-app agent and over MCP (/api/mcp).
 *
 * Four kinds of tool, and the kind is the permission:
 *   read     — returns records, with the source of each fact
 *   compute  — deterministic arithmetic and rule checks; no model involved
 *   draft    — writes something internal a person reviews (a follow-up, a draft quote, a request)
 *   request  — asks a person to approve a customer-facing or irreversible step;
 *              never performs it. Sending a message and marking a deal Won only
 *              happen when someone clicks Approve in the workspace.
 *
 * Hard rules enforced here rather than in a prompt:
 *   - Prices come only from the catalog (`@/lib/catalog`). There is no tool
 *     that accepts a price from the model.
 *   - Deal history (ACV, ARR) is returned as history, labelled as such, and is
 *     never used as a price.
 *   - No tool returns a secret, a key or a raw database id the model could not
 *     already see.
 * Every call is recorded in a trace the workspace shows under the AI process.
 */

export type ToolKind = "read" | "compute" | "draft" | "request";

export interface SalesToolCall {
  tool: string;
  kind: ToolKind;
  input: string;
  output: string;
  sources: string[];
  ok: boolean;
  duration_ms: number;
}

export class SalesToolTrace {
  readonly calls: SalesToolCall[] = [];
}

export interface ToolContext {
  actorName: string;
  trace: SalesToolTrace;
}

export interface ToolResult {
  data: unknown;
  summary: string;
  sources?: string[];
}

export interface SalesTool {
  name: string;
  kind: ToolKind;
  description: string;
  input_schema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

/* ------------------------------------------------------------ arg helpers */

class ToolInputError extends Error {}
const str = (a: Record<string, unknown>, k: string, required = true): string => {
  const v = a[k];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (required) throw new ToolInputError(`"${k}" is required`);
  return "";
};
const num = (a: Record<string, unknown>, k: string, dflt?: number): number => {
  const v = Number(a[k]);
  if (Number.isFinite(v)) return v;
  if (dflt !== undefined) return dflt;
  throw new ToolInputError(`"${k}" must be a number`);
};
const linesArg = (a: Record<string, unknown>): PriceRequestLine[] => {
  const raw = a.lines;
  if (!Array.isArray(raw) || !raw.length) throw new ToolInputError(`"lines" must be a non-empty array of { product_code, quantity, discount_pct? }`);
  return raw.map((l) => {
    const o = (l ?? {}) as Record<string, unknown>;
    // A price in the input is ignored on purpose — prices only come from the catalog.
    return { product_code: String(o.product_code ?? ""), quantity: Number(o.quantity ?? 0), discount_pct: Number(o.discount_pct ?? 0) };
  });
};

const LEAD = { lead_id: { type: "string", description: "Opportunity id" } };
const LINES = {
  lines: {
    type: "array",
    description: "Quote lines by product code. Prices are never accepted here; they come from the catalog.",
    items: { type: "object", properties: { product_code: { type: "string" }, quantity: { type: "number" }, discount_pct: { type: "number" } }, required: ["product_code", "quantity"] },
  },
};

async function leadOrThrow(leadId: string) {
  const lead = await getLeadById(leadId);
  if (!lead) throw new ToolInputError("Opportunity not found");
  return lead;
}

async function companyFrom(args: Record<string, unknown>): Promise<Company> {
  if (typeof args.company_id === "string" && args.company_id) {
    const c = await queryOne<Company>("select * from companies where id = $1", [args.company_id]);
    if (c) return c;
  }
  if (typeof args.lead_id === "string" && args.lead_id) {
    const lead = await leadOrThrow(args.lead_id);
    const c = await queryOne<Company>("select * from companies where id = $1", [lead.company_id]);
    if (c) return c;
  }
  if (typeof args.company_name === "string" && args.company_name) {
    const hit = await findCompanyByName(args.company_name);
    if (hit) return (await queryOne<Company>("select * from companies where id = $1", [hit.id])) as Company;
  }
  throw new ToolInputError("Pass lead_id, company_id or company_name");
}

const CUSTOMER_ARGS = {
  lead_id: { type: "string" },
  company_id: { type: "string" },
  company_name: { type: "string", description: "Account name, e.g. Planet Home Lending" },
};

function stripIds(h: DealHistoryRow): Omit<DealHistoryRow, "activity_id" | "lead_id" | "company_id"> {
  const copy: Partial<DealHistoryRow> = { ...h };
  delete copy.activity_id;
  delete copy.lead_id;
  delete copy.company_id;
  return copy as Omit<DealHistoryRow, "activity_id" | "lead_id" | "company_id">;
}

function historyLine(h: DealHistoryRow) {
  const value = h.acv != null ? `ACV ${formatMoney(h.acv)}` : h.arr_change != null ? `ARR +${formatMoney(h.arr_change)}` : "value not recorded";
  return `${h.closed_at} ${h.deal_type}: ${h.products.map((p) => p.name).join(" + ")} · ${value}`;
}

function historySources(rows: DealHistoryRow[]) {
  return [...new Set(rows.map((h) => `Deal history · ${h.company_name} · closed ${h.closed_at} (${h.source})`))];
}

/* ---------------------------------------------------------------- registry */

export const SALES_TOOLS: SalesTool[] = [
  // 1. Customer context
  {
    name: "get_customer",
    kind: "read",
    description: "The account: name, domain, industry.",
    input_schema: { type: "object", properties: CUSTOMER_ARGS },
    async run(args) {
      const c = await companyFrom(args);
      return { data: { id: c.id, name: c.name, domain: c.domain, industry: c.industry }, summary: `${c.name}${c.industry ? ` · ${c.industry}` : ""}`, sources: [`Company record · ${c.name}`] };
    },
  },
  {
    name: "get_contacts",
    kind: "read",
    description: "Contacts at the account.",
    input_schema: { type: "object", properties: CUSTOMER_ARGS },
    async run(args) {
      const c = await companyFrom(args);
      const contacts = await listContactsForCompany(c.id);
      return {
        data: contacts.map((x) => ({ name: x.name, title: x.title, email: x.email, is_primary: x.is_primary })),
        summary: `${contacts.length} contact${contacts.length === 1 ? "" : "s"}`,
        sources: [`Contacts · ${c.name}`],
      };
    },
  },
  {
    name: "get_opportunity",
    kind: "read",
    description: "An opportunity: stage, interest, users, requirements.",
    input_schema: { type: "object", properties: LEAD, required: ["lead_id"] },
    async run(args) {
      const lead = await leadOrThrow(str(args, "lead_id"));
      return {
        data: { id: lead.id, status: lead.status, interest: lead.interest, number_of_users: lead.number_of_users, requirements: lead.requirements },
        summary: `${lead.status} · ${lead.interest ?? "no interest stated"} · ${lead.number_of_users ?? "?"} users`,
        sources: ["Opportunity record"],
      };
    },
  },
  {
    name: "get_activities",
    kind: "read",
    description: "The opportunity's activity timeline, newest first.",
    input_schema: { type: "object", properties: { ...LEAD, limit: { type: "number" } }, required: ["lead_id"] },
    async run(args) {
      const acts = await listActivitiesForLead(str(args, "lead_id"));
      const limit = Math.min(50, num(args, "limit", 20));
      return {
        data: acts.slice(0, limit).map((a) => ({ type: a.type, at: a.occurred_at, by: a.actor_name, body: a.body })),
        summary: `${acts.length} activit${acts.length === 1 ? "y" : "ies"}`,
        sources: ["Activity timeline"],
      };
    },
  },
  {
    name: "get_qualification",
    kind: "read",
    description: "Captured and missing qualification fields.",
    input_schema: { type: "object", properties: LEAD, required: ["lead_id"] },
    async run(args) {
      const view = qualificationView(await leadOrThrow(str(args, "lead_id")));
      return { data: view, summary: `${view.captured.length} captured · ${view.missing.length} missing`, sources: ["Qualification tab"] };
    },
  },
  {
    name: "get_customer_product_history",
    kind: "read",
    description: "Every deal the account has closed: products, type (new/expansion/renewal), ACV/ARR, dates. History, not pricing.",
    input_schema: { type: "object", properties: CUSTOMER_ARGS },
    async run(args) {
      const c = await companyFrom(args);
      const rows = await dealHistoryForCompany(c.id);
      return {
        data: { note: "Historical deal values are customer history. They are not current list prices.", deals: rows.map(stripIds) },
        summary: rows.length ? rows.map(historyLine).join("; ") : "no closed deals on record",
        sources: historySources(rows),
      };
    },
  },
  // 2. Product and pricing
  {
    name: "get_products",
    kind: "read",
    description: "The product catalog with list prices and units.",
    input_schema: { type: "object", properties: {} },
    async run() {
      const products = getProducts();
      return { data: { price_list: PRICE_LIST, products }, summary: `${products.length} products · ${PRICE_LIST.version}`, sources: [`${PRICE_LIST.label} v${PRICE_LIST.version}`] };
    },
  },
  {
    name: "get_product_price",
    kind: "read",
    description: "Current list price for one product code.",
    input_schema: { type: "object", properties: { product_code: { type: "string" } }, required: ["product_code"] },
    async run(args) {
      const p = getProduct(str(args, "product_code"));
      if (!p) throw new ToolInputError(`Unknown product code — call get_products for valid codes`);
      return {
        data: { code: p.code, name: p.name, list_price: p.list_price, unit: p.unit, billing_period: p.billing_period, currency: PRICE_LIST.currency, price_list_version: PRICE_LIST.version, is_demo: PRICE_LIST.is_demo },
        summary: `${p.name}: ${formatMoney(p.list_price)} ${unitLabel(p.unit)}`,
        sources: [`${PRICE_LIST.label} v${PRICE_LIST.version}`],
      };
    },
  },
  {
    name: "get_current_contract",
    kind: "read",
    description: "The account's contract in force today (products, ACV, term dates).",
    input_schema: { type: "object", properties: CUSTOMER_ARGS },
    async run(args) {
      const c = await companyFrom(args);
      const cur = currentContract(await dealHistoryForCompany(c.id));
      return {
        data: cur ? { deal_type: cur.deal_type, products: cur.products, acv: cur.acv, start_date: cur.start_date, end_date: cur.end_date, term_months: cur.term_months, note: "ACV is what this customer paid — history, not the current list price." } : null,
        summary: cur ? `${cur.products.map((p) => p.name).join(" + ")} · ${cur.acv != null ? `ACV ${formatMoney(cur.acv)}` : "ACV not recorded"} · to ${cur.end_date ?? "?"}` : "no contract on record",
        sources: cur ? historySources([cur]) : [],
      };
    },
  },
  {
    name: "get_pricing_rules",
    kind: "read",
    description: "How quotes are priced: price list, units, the calculation.",
    input_schema: { type: "object", properties: {} },
    async run() {
      return {
        data: { price_list: PRICE_LIST, formula: "line = quantity × current list price × (1 − line discount); total = (Σ lines) × (1 − additional discount) × (1 + tax)", units: { user: "per user / year", location: "per location / year", platform: "flat / year" }, prices_from: "catalog only — the model never supplies a price" },
        summary: `${PRICE_LIST.version} · quantity × list − discount + tax`,
        sources: [`${PRICE_LIST.label} v${PRICE_LIST.version}`],
      };
    },
  },
  {
    name: "get_discount_rules",
    kind: "read",
    description: "Discount thresholds and per-product ceilings.",
    input_schema: { type: "object", properties: {} },
    async run() {
      const r = discountRules();
      return {
        data: { rep_may_give_up_to_pct: r.managerPct, manager_may_approve_up_to_pct: r.adminPct, above_that: "admin approval", per_product_ceiling_pct: Object.fromEntries(getProducts().map((p) => [p.code, p.max_discount_pct])) },
        summary: `rep ≤${r.managerPct}% · manager ≤${r.adminPct}% · per-product ceilings`,
        sources: ["Discount rules (QUOTE_DISCOUNT_APPROVAL_PCT / QUOTE_DISCOUNT_ADMIN_PCT)", `${PRICE_LIST.label} v${PRICE_LIST.version}`],
      };
    },
  },
  {
    name: "calculate_quote_total",
    kind: "compute",
    description: "Price product lines from the catalog and total them. Deterministic.",
    input_schema: { type: "object", properties: { ...LINES, additional_discount_pct: { type: "number" }, tax_pct: { type: "number" } }, required: ["lines"] },
    async run(args) {
      const priced = calculateQuote(linesArg(args), discountRules(), { additional_discount_pct: num(args, "additional_discount_pct", 0), tax_pct: num(args, "tax_pct", 0) });
      return {
        data: priced,
        summary: `${priced.lines.map((l) => `${l.quantity} × ${l.product_code} @ ${formatMoney(l.list_price)}${l.discount_pct ? ` −${l.discount_pct}%` : ""}`).join(" + ")} = ${formatMoney(priced.totals.total)}${priced.unknown_products.length ? ` · unknown: ${priced.unknown_products.join(", ")}` : ""}`,
        sources: [`${PRICE_LIST.label} v${PRICE_LIST.version}`, "Quote arithmetic (lib/quotes/math)"],
      };
    },
  },
  {
    name: "validate_discount",
    kind: "compute",
    description: "Check a requested discount against the rules; says whether approval is needed and whose.",
    input_schema: { type: "object", properties: { product_code: { type: "string" }, discount_pct: { type: "number" } }, required: ["discount_pct"] },
    async run(args) {
      const check = validateDiscount(str(args, "product_code", false) || null, num(args, "discount_pct"), discountRules());
      return { data: check, summary: `${check.requested_pct}% → ${check.level === "ok" ? "allowed" : `${check.level} approval`}`, sources: ["Discount rules", `${PRICE_LIST.label} v${PRICE_LIST.version}`] };
    },
  },
  // 3. Sales intelligence
  ...(["win", "renewal", "expansion"] as const).map<SalesTool>((kind) => ({
    name: kind === "win" ? "get_recent_wins" : kind === "renewal" ? "get_recent_renewals" : "get_recent_expansions",
    kind: "read",
    description: `Recent ${kind === "win" ? "closed-won deals of any type" : `${kind}s`} across accounts. History, not pricing.`,
    input_schema: { type: "object", properties: { since_days: { type: "number" }, limit: { type: "number" } } },
    async run(args) {
      const rows = await recentDeals({ type: kind === "win" ? undefined : (kind as DealType), sinceDays: num(args, "since_days", 365), limit: Math.min(25, num(args, "limit", 10)) });
      return {
        data: rows.map((h) => ({ company: h.company_name, deal_type: h.deal_type, products: h.products.map((p) => p.name), acv: h.acv, arr_change: h.arr_change, closed_at: h.closed_at, source: h.source })),
        summary: rows.length ? rows.map((h) => `${h.company_name} (${historyLine(h)})`).join("; ") : "none in range",
        sources: historySources(rows),
      };
    },
  })),
  {
    name: "get_customer_acv_history",
    kind: "read",
    description: "The account's ACV and ARR changes over time. History, not pricing.",
    input_schema: { type: "object", properties: CUSTOMER_ARGS },
    async run(args) {
      const c = await companyFrom(args);
      const rows = await dealHistoryForCompany(c.id);
      return {
        data: rows.map((h) => ({ closed_at: h.closed_at, deal_type: h.deal_type, acv: h.acv, arr_change: h.arr_change })),
        summary: rows.length ? rows.map((h) => `${h.closed_at}: ${h.acv != null ? formatMoney(h.acv) : h.arr_change != null ? `+${formatMoney(h.arr_change)} ARR` : "not recorded"}`).join(" → ") : "no history",
        sources: historySources(rows),
      };
    },
  },
  // 4. Quote preparation
  {
    name: "identify_missing_quote_items",
    kind: "compute",
    description: "What the customer asked for that the proposed lines do not cover.",
    input_schema: { type: "object", properties: { ...LEAD, ...LINES }, required: ["lead_id", "lines"] },
    async run(args) {
      const lead = await leadOrThrow(str(args, "lead_id"));
      const brief = await getLatestBrief(lead.id);
      const priced = calculateQuote(linesArg(args), discountRules());
      const missing = uncoveredRequirements({ items: priced.lines, lead, intelligence: hasIntelligence(brief) ? brief.intelligence : null });
      return { data: { missing, unknown_products: priced.unknown_products }, summary: missing.length ? `not covered: ${missing.join(", ")}` : "every requested area is covered", sources: ["Opportunity interest & requirements", "AI Deal Brief"] };
    },
  },
  {
    name: "validate_quote_against_customer_requirements",
    kind: "compute",
    description: "Full quote check: budget, qualification, validity, pricing vs list, approvals.",
    input_schema: { type: "object", properties: { ...LEAD, ...LINES, valid_until: { type: "string" } }, required: ["lead_id", "lines"] },
    async run(args) {
      const lead = await leadOrThrow(str(args, "lead_id"));
      const brief = await getLatestBrief(lead.id);
      const priced = calculateQuote(linesArg(args), discountRules());
      const validUntil = str(args, "valid_until", false) || new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
      const review = reviewQuote({ items: priced.lines, validUntil, lead, intelligence: hasIntelligence(brief) ? brief.intelligence : null });
      return { data: { review, approval: priced.approval, approval_reasons: priced.approval_reasons, total: priced.totals.total }, summary: review.issues.length ? review.issues.join(" ") : `clean · ${formatMoney(priced.totals.total)}`, sources: ["Quote check (lib/quotes/review)", "Qualification tab"] };
    },
  },
  {
    name: "draft_quote_narrative",
    kind: "draft",
    description: "Draft the short customer note for a quote, grounded only in the record. Returns text; saves nothing.",
    input_schema: { type: "object", properties: { ...LEAD, ...LINES }, required: ["lead_id", "lines"] },
    async run(args) {
      const lead = await leadOrThrow(str(args, "lead_id"));
      const company = (await queryOne<Company>("select * from companies where id = $1", [lead.company_id])) as Company;
      const contacts = await listContactsForCompany(lead.company_id);
      const brief = await getLatestBrief(lead.id);
      const intel = hasIntelligence(brief) ? brief.intelligence : null;
      const priced = calculateQuote(linesArg(args), discountRules());
      const existing = await listQuotesForLead(lead.id);
      const n = await draftQuoteNarrative({
        lead,
        company,
        contact: contacts.find((c) => c.is_primary) ?? contacts[0] ?? null,
        intelligence: intel,
        items: priced.lines,
        notCovered: uncoveredRequirements({ items: priced.lines, lead, intelligence: intel }),
        version: (existing[0]?.meta.version ?? 0) + 1,
      });
      return { data: n, summary: `${n.generated_by === "claude" ? "Claude" : "deterministic"} draft · ${n.note.slice(0, 80)}${n.note.length > 80 ? "…" : ""}`, sources: n.grounded_in };
    },
  },
  // 5. Controlled actions
  {
    name: "create_follow_up",
    kind: "draft",
    description: "Schedule an internal follow-up on the opportunity (not sent to the customer).",
    input_schema: { type: "object", properties: { ...LEAD, when: { type: "string", description: "ISO date-time" }, title: { type: "string" }, note: { type: "string" } }, required: ["lead_id", "when"] },
    async run(args, ctx) {
      const lead = await leadOrThrow(str(args, "lead_id"));
      const when = new Date(str(args, "when"));
      if (Number.isNaN(when.getTime())) throw new ToolInputError(`"when" must be an ISO date-time`);
      const a = await scheduleFollowUp({ leadId: lead.id, scheduledFor: when, title: str(args, "title", false) || "Follow up", note: str(args, "note", false) || null, actorName: ctx.actorName, source: "rep" });
      return { data: { activity_id: a.id, scheduled_for: when.toISOString() }, summary: `follow-up ${when.toISOString().slice(0, 16).replace("T", " ")}`, sources: ["Scheduled tasks"] };
    },
  },
  {
    name: "create_quote_draft",
    kind: "draft",
    description: "Create a DRAFT quote from product lines, priced from the catalog. Drafts are never sent; approvals and sending stay with people.",
    input_schema: { type: "object", properties: { ...LEAD, ...LINES, additional_discount_pct: { type: "number" }, term_months: { type: "number" }, start_date: { type: "string" }, notes: { type: "string" }, target_amount: { type: "number" } }, required: ["lead_id", "lines"] },
    async run(args, ctx) {
      const lead = await leadOrThrow(str(args, "lead_id"));
      const priced = calculateQuote(linesArg(args), discountRules());
      if (!priced.lines.length) throw new ToolInputError("No valid product codes — call get_products");
      const fd = new FormData();
      priced.lines.forEach((l, i) => {
        fd.set(`item_${i}_description`, l.description);
        fd.set(`item_${i}_quantity`, String(l.quantity));
        fd.set(`item_${i}_unit_price`, String(l.unit_price));
        fd.set(`item_${i}_discount_pct`, String(l.discount_pct));
      });
      fd.set("valid_until", new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10));
      fd.set("start_date", str(args, "start_date", false) || new Date().toISOString().slice(0, 10));
      fd.set("term_months", String(num(args, "term_months", 12)));
      fd.set("additional_discount_pct", String(num(args, "additional_discount_pct", 0)));
      if (args.target_amount != null) fd.set("target_amount", String(num(args, "target_amount", 0)));
      fd.set("terms", "Annual subscription, billed annually. Net 30.");
      if (str(args, "notes", false)) fd.set("notes", str(args, "notes", false));
      const existing = await listQuotesForLead(lead.id);
      const version = (existing[0]?.meta.version ?? 0) + 1;
      const meta = await buildMeta(lead.id, fd, version, ctx.actorName, newQuoteId());
      if ("error" in meta) throw new ToolInputError(meta.error);
      for (const q of existing.filter((q) => !q.meta.superseded)) await patchQuote(q.activityId, { superseded: true });
      const row = await insertQuote(lead.id, meta, ctx.actorName);
      return {
        data: { activity_id: row.activityId, version, total: meta.total, needs_approval: meta.review.needs_approval, approvals: meta.approvals },
        summary: `draft v${version} · ${formatMoney(meta.total)}${meta.review.needs_approval ? ` · needs ${meta.approvals?.map((a) => a.role).join(" + ") || "approval"}` : ""}`,
        sources: [`${PRICE_LIST.label} v${PRICE_LIST.version}`, "Quote check + approval chain"],
      };
    },
  },
  {
    name: "apply_discount_request",
    kind: "request",
    description: "Record a customer's discount request on the opportunity, validated against the rules. Does not change any quote.",
    input_schema: { type: "object", properties: { ...LEAD, product_code: { type: "string" }, discount_pct: { type: "number" }, reason: { type: "string" } }, required: ["lead_id", "discount_pct"] },
    async run(args, ctx) {
      const lead = await leadOrThrow(str(args, "lead_id"));
      const check = validateDiscount(str(args, "product_code", false) || null, num(args, "discount_pct"), discountRules());
      const a = await recordActivity({
        leadId: lead.id,
        type: "note",
        body: `Discount request: ${check.requested_pct}%${check.product ? ` on ${getProduct(check.product)?.name}` : ""} — ${check.reason}${str(args, "reason", false) ? ` Customer's reason: ${str(args, "reason", false)}` : ""}`,
        actorName: ctx.actorName,
        metadata: { kind: "discount_request", ...check },
      });
      return { data: { activity_id: a.id, ...check }, summary: `${check.requested_pct}% → ${check.level === "ok" ? "within rep authority" : `${check.level} approval required`}`, sources: ["Discount rules"] };
    },
  },
  ...(
    [
      { name: "send_customer_message", action: "send_customer_message", desc: "Draft a message to the customer for a person to approve and send. Never sends." },
      { name: "mark_opportunity_won", action: "mark_opportunity_won", desc: "Ask a manager to mark the opportunity Won. Never changes the status itself." },
    ] as const
  ).map<SalesTool>((t) => ({
    name: t.name,
    kind: "request",
    description: t.desc,
    input_schema: {
      type: "object",
      properties: t.action === "send_customer_message" ? { ...LEAD, subject: { type: "string" }, body: { type: "string" } } : { ...LEAD, reason: { type: "string" } },
      required: t.action === "send_customer_message" ? ["lead_id", "subject", "body"] : ["lead_id"],
    },
    async run(args, ctx) {
      const lead = await leadOrThrow(str(args, "lead_id"));
      const meta: ApprovalRequestMeta = {
        kind: APPROVAL_REQUEST_KIND,
        action: t.action,
        state: "pending",
        requested_by: ctx.actorName,
        requested_at: new Date().toISOString(),
        ...(t.action === "send_customer_message" ? { subject: str(args, "subject"), message: str(args, "body") } : { reason: str(args, "reason", false) || null }),
      };
      const a = await recordActivity({
        leadId: lead.id,
        type: "note",
        body: t.action === "send_customer_message" ? `Approval requested: send "${meta.subject}" to the customer.` : "Approval requested: mark this opportunity Won.",
        actorName: ctx.actorName,
        metadata: meta as unknown as Record<string, unknown>,
      });
      return { data: { activity_id: a.id, state: "pending", note: "Nothing was sent or changed. A person approves this in the workspace." }, summary: "pending human approval", sources: ["Approval queue"] };
    },
  })),
];

export function toolByName(name: string): SalesTool | undefined {
  return SALES_TOOLS.find((t) => t.name === name);
}

/** Run one tool through the trace. Input errors come back as a failed call, not a crash. */
export async function runTool(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult & { ok: boolean; error?: string }> {
  const tool = toolByName(name);
  const started = Date.now();
  const input = summarizeArgs(args);
  if (!tool) {
    ctx.trace.calls.push({ tool: name, kind: "read", input, output: "unknown tool", sources: [], ok: false, duration_ms: 0 });
    return { ok: false, error: `Unknown tool ${name}`, data: null, summary: "unknown tool" };
  }
  try {
    const r = await tool.run(args, ctx);
    ctx.trace.calls.push({ tool: name, kind: tool.kind, input, output: r.summary, sources: r.sources ?? [], ok: true, duration_ms: Date.now() - started });
    return { ...r, ok: true };
  } catch (err) {
    const message = err instanceof ToolInputError ? err.message : "Tool failed";
    if (!(err instanceof ToolInputError)) console.error(`Tool ${name} failed:`, err);
    ctx.trace.calls.push({ tool: name, kind: tool.kind, input, output: message, sources: [], ok: false, duration_ms: Date.now() - started });
    return { ok: false, error: message, data: null, summary: message };
  }
}

function summarizeArgs(args: Record<string, unknown>) {
  const parts = Object.entries(args)
    .filter(([k]) => k !== "lead_id" && k !== "company_id")
    .map(([k, v]) => `${k}=${Array.isArray(v) ? `${v.length} line${v.length === 1 ? "" : "s"}` : typeof v === "object" ? "…" : String(v).slice(0, 40)}`);
  return parts.length ? parts.join(", ") : "—";
}
