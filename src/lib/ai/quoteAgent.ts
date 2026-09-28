import { callClaudeJson, claudeAvailable, claudeModel } from "@/lib/ai/claude";
import { runTool, SalesToolTrace, type SalesToolCall } from "@/lib/ai/salesTools";
import { findProduct, getProduct, getProducts, PRICE_LIST } from "@/lib/catalog/catalog";
import type { PricedQuote, PriceRequestLine } from "@/lib/catalog/pricing";
import type { DealHistoryMeta } from "@/lib/repo/salesHistory";

/**
 * Quote preparation agent.
 *
 *   customer history → product retrieval → current pricing → quote calculation
 *   → discount validation → coverage + requirement checks → proposal
 *
 * The model's only job is judgement: which catalog products and quantities fit
 * this customer, and what discount they asked for. It never sees a price it
 * could repeat as its own and never returns one — every number in the
 * proposal comes back from the pricing tools. When Claude is unavailable the
 * same pipeline runs with a deterministic product choice.
 *
 * Nothing is written. The proposal is shown to the rep, who creates the draft
 * quote (create_quote_draft) with one click; approvals and sending stay with
 * people.
 */

export interface QuoteProposal {
  lines: PriceRequestLine[];
  priced: PricedQuote | null;
  requested_discount_pct: number;
  rationale: string;
  evidence: string[];
  missing: string[];
  issues: string[];
  generated_by: "claude" | "deterministic";
  model: string | null;
  fallback_reason: string | null;
  trace: SalesToolCall[];
  price_list: typeof PRICE_LIST;
}

interface Choice {
  lines: PriceRequestLine[];
  requested_discount_pct: number;
  rationale: string;
  evidence: string[];
}

export async function prepareQuote(leadId: string, actorName: string): Promise<QuoteProposal> {
  const trace = new SalesToolTrace();
  const ctx = { actorName, trace };
  const opp = await runTool("get_opportunity", { lead_id: leadId }, ctx);
  if (!opp.ok) throw new Error(opp.error);
  const o = opp.data as { interest: string | null; number_of_users: number | null; requirements: string | null };
  await runTool("get_customer", { lead_id: leadId }, ctx);
  const history = await runTool("get_customer_product_history", { lead_id: leadId }, ctx);
  const current = await runTool("get_current_contract", { lead_id: leadId }, ctx);
  const qual = await runTool("get_qualification", { lead_id: leadId }, ctx);
  await runTool("get_products", {}, ctx);
  await runTool("get_discount_rules", {}, ctx);

  const facts = {
    opportunity: o,
    qualification: qual.data,
    current_contract: current.data,
    history: (history.data as { deals: Omit<DealHistoryMeta, "kind">[] } | null)?.deals ?? [],
    catalog: getProducts().map((p) => ({ code: p.code, name: p.name, family: p.family, unit: p.unit })),
  };

  let choice = deterministicChoice(facts);
  let generated_by: QuoteProposal["generated_by"] = "deterministic";
  let model: string | null = null;
  let fallback_reason: string | null = claudeAvailable() ? null : "Claude is not configured — deterministic product choice.";
  if (claudeAvailable()) {
    try {
      const res = await callClaudeJson<Choice>({
        system: SYSTEM,
        user: JSON.stringify(facts),
        maxTokens: 700,
        validate: validateChoice,
      });
      choice = res.data;
      generated_by = "claude";
      model = claudeModel();
    } catch (err) {
      fallback_reason = `Claude's answer was not usable (${err instanceof Error ? err.message.slice(0, 120) : "error"}) — deterministic product choice.`;
    }
  }

  // Apply the requested discount to each line, then let the tools price and judge it.
  const lines = choice.lines.map((l) => ({ ...l, discount_pct: choice.requested_discount_pct }));
  for (const l of lines) await runTool("get_product_price", { product_code: l.product_code }, ctx);
  const priced = await runTool("calculate_quote_total", { lines }, ctx);
  await runTool("validate_discount", { discount_pct: choice.requested_discount_pct, product_code: lines.length === 1 ? lines[0].product_code : undefined }, ctx);
  const missing = await runTool("identify_missing_quote_items", { lead_id: leadId, lines }, ctx);
  const check = await runTool("validate_quote_against_customer_requirements", { lead_id: leadId, lines }, ctx);

  return {
    lines,
    priced: priced.ok ? (priced.data as PricedQuote) : null,
    requested_discount_pct: choice.requested_discount_pct,
    rationale: choice.rationale,
    evidence: choice.evidence,
    missing: ((missing.data as { missing?: string[] } | null)?.missing) ?? [],
    issues: ((check.data as { review?: { issues?: string[] } } | null)?.review?.issues) ?? [],
    generated_by,
    model,
    fallback_reason,
    trace: trace.calls,
    price_list: PRICE_LIST,
  };
}

const SYSTEM = `You prepare the product lines for a B2B software quote at Experience.com.
You receive: the opportunity, its qualification, the customer's current contract and deal history, and the product catalog (codes, names, families, units — no prices).
Return JSON: {"lines":[{"product_code":string,"quantity":number}],"requested_discount_pct":number,"rationale":string,"evidence":[string]}
Rules:
- Use ONLY product codes from the catalog. Never output a price or a total — pricing is done by separate tools.
- For a renewal, start from the products on the current contract; add or change products only if the opportunity or qualification says so.
- Quantity = users for "user" products, locations for "location", 1 for "platform".
- requested_discount_pct = the discount the customer explicitly asked for in the record, else 0. Do not propose a discount of your own.
- Deal history values (ACV/ARR) are history only; never treat them as prices.
- evidence: short quotes or facts from the input that justify each choice.
- rationale: one or two plain sentences.`;

function validateChoice(raw: unknown): Choice {
  const r = raw as Partial<Choice>;
  if (!r || !Array.isArray(r.lines) || !r.lines.length) throw new Error("no lines");
  const lines = r.lines.map((l) => {
    const p = getProduct(String((l as PriceRequestLine).product_code ?? ""));
    const q = Math.round(Number((l as PriceRequestLine).quantity));
    if (!p) throw new Error(`unknown product ${(l as PriceRequestLine).product_code}`);
    if (!Number.isFinite(q) || q <= 0 || q > 100_000) throw new Error("bad quantity");
    return { product_code: p.code, quantity: p.unit === "platform" ? 1 : q };
  });
  const d = Number(r.requested_discount_pct ?? 0);
  if (!Number.isFinite(d) || d < 0 || d > 100) throw new Error("bad discount");
  return { lines, requested_discount_pct: Math.round(d * 10) / 10, rationale: String(r.rationale ?? "").slice(0, 400), evidence: Array.isArray(r.evidence) ? r.evidence.map(String).slice(0, 6) : [] };
}

/** Same judgement without a model: renew what they have, else map what they asked for. */
function deterministicChoice(f: {
  opportunity: { interest: string | null; number_of_users: number | null; requirements: string | null };
  current_contract: unknown;
}): Choice {
  const users = f.opportunity.number_of_users ?? 1;
  const text = `${f.opportunity.interest ?? ""} ${f.opportunity.requirements ?? ""}`;
  const contract = f.current_contract as { products?: { code: string; quantity?: number | null }[] } | null;
  const asked = text.match(/(\d{1,2}(?:\.\d)?)\s*%\s*discount/i);
  const requested = asked ? Number(asked[1]) : 0;
  if (contract?.products?.length && /renew/i.test(text)) {
    return {
      lines: contract.products.map((p) => ({ product_code: p.code, quantity: getProduct(p.code)?.unit === "platform" ? 1 : p.quantity ?? users })),
      requested_discount_pct: requested,
      rationale: "Renewal: the quote carries the products on the current contract at today's list price.",
      evidence: ["Current contract products", ...(asked ? [`Customer asked for "${asked[0]}"`] : [])],
    };
  }
  const p = findProduct(f.opportunity.interest ?? "") ?? findProduct(text);
  return {
    lines: p ? [{ product_code: p.code, quantity: p.unit === "platform" ? 1 : users }] : [],
    requested_discount_pct: requested,
    rationale: p ? `Mapped the customer's interest (${f.opportunity.interest}) to ${p.name}.` : "No catalog product matches the stated interest.",
    evidence: f.opportunity.interest ? [`Interest: ${f.opportunity.interest}`] : [],
  };
}
