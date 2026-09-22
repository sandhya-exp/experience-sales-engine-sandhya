import type { Lead } from "@/lib/types";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";
import type { QuoteApprovalStep } from "@/lib/repo/quotes";
import { computeTotals, type QuoteAdjustments, type QuoteLineItem } from "@/lib/quotes/math";
import { parseBudget } from "@/lib/quotes/review";

/**
 * Discount rules, and the approval chain they produce.
 *
 * Two tiers rather than one flag, because "needs approval" is not one question:
 * a modest discount is a sales manager's call on a deal they already coach,
 * while a deep one, or a price above what the customer said they could spend,
 * is a commitment the business makes and belongs with an admin. The chain is
 * ordered and cumulative — a 30% discount needs the manager *and* the admin,
 * and the quote cannot go out until both have signed.
 *
 * The thresholds are configuration, not opinion:
 *   QUOTE_DISCOUNT_APPROVAL_PCT  above this, a manager approves   (default 15)
 *   QUOTE_DISCOUNT_ADMIN_PCT     above this, an admin approves too (default 25)
 *
 * Nothing here sets or suggests a price. It reads the numbers a person typed
 * and says who has to agree to them.
 */
export interface DiscountRules {
  managerPct: number;
  adminPct: number;
}

export function discountRules(): DiscountRules {
  const managerPct = positive(process.env.QUOTE_DISCOUNT_APPROVAL_PCT, 15);
  const adminPct = Math.max(managerPct + 1, positive(process.env.QUOTE_DISCOUNT_ADMIN_PCT, 25));
  return { managerPct, adminPct };
}

function positive(v: string | undefined, dflt: number) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}

/**
 * The authority one line's discount needs, on its own.
 *
 * The chain below is computed from the quote as a whole, which is the rule that
 * actually gates sending. This is the same thresholds read line by line, so the
 * editor can tell a rep *which* line is the one pulling an approval in while
 * they are still typing — a 40% discount hidden among six clean lines is
 * otherwise invisible until the quote is saved.
 *
 * Takes the rules as an argument rather than reading them, because the editor
 * runs in the browser where the environment isn't.
 */
export function lineApproval(discountPct: number, rules: DiscountRules): "ok" | "manager" | "admin" {
  if (discountPct > rules.adminPct) return "admin";
  if (discountPct > rules.managerPct) return "manager";
  return "ok";
}

/**
 * Who must sign this quote off before it can be sent.
 *
 * Returns the chain in the order it has to be satisfied. An empty chain means
 * the quote is inside every rule and the rep's own manager does not need to be
 * involved at all — which is the common case, and keeping it common is the
 * point of having thresholds rather than approving everything.
 */
export function approvalChainFor(args: { items: QuoteLineItem[]; lead: Lead; intelligence: OpportunityIntelligence | null; adjustments?: QuoteAdjustments }): QuoteApprovalStep[] {
  const rules = discountRules();
  const totals = computeTotals(args.items, args.adjustments);
  const steps: QuoteApprovalStep[] = [];

  if (totals.discount_pct > rules.managerPct) {
    steps.push({
      role: "manager",
      reason: `Discount of ${totals.discount_pct}% is above the ${rules.managerPct}% a rep may give on their own.`,
      state: "pending",
    });
  }

  if (totals.discount_pct > rules.adminPct) {
    steps.push({
      role: "admin",
      reason: `Discount of ${totals.discount_pct}% is above the ${rules.adminPct}% a manager may approve alone.`,
      state: "pending",
    });
  }

  // Pricing above what the customer told us they had is a commercial decision
  // regardless of the discount, so it brings a manager in on its own.
  const budget = parseBudget(args.lead.qualification?.budget ?? null);
  if (budget && totals.total > budget.amount && !steps.some((s) => s.role === "manager")) {
    steps.push({
      role: "manager",
      reason: `Total is above the budget the customer stated (${args.lead.qualification?.budget}).`,
      state: "pending",
    });
  }

  return steps.sort((a, b) => (a.role === b.role ? 0 : a.role === "manager" ? -1 : 1));
}

/** The next step waiting on someone, or null when the chain is complete. */
export function pendingStep(steps: QuoteApprovalStep[] | undefined): QuoteApprovalStep | null {
  return (steps ?? []).find((s) => s.state === "pending") ?? null;
}

export function chainComplete(steps: QuoteApprovalStep[] | undefined): boolean {
  return (steps ?? []).every((s) => s.state === "approved");
}

/**
 * What the customer asked about that this quote does not price.
 *
 * A partial quote is normal — they asked about four things and this prices
 * three, because the fourth needs a conversation first. What is not normal is
 * the customer discovering that themselves. This compares the capabilities the
 * intelligence identified from their own words against the line items, matching
 * loosely on words so "Reputation Management — 60 users" covers "Reputation
 * Management", and returns what is left over.
 *
 * It never invents a requirement: everything it can return came from something
 * the customer wrote or an interest they picked.
 */
export function uncoveredRequirements(args: { items: QuoteLineItem[]; lead: Lead; intelligence: OpportunityIntelligence | null }): string[] {
  // Only things a *customer* would recognise as something they asked for. A
  // knowledge-base capability title like "Mortgage & real-estate systems
  // (Encompass, other LOS, MLS, Zillow)" is internal reference material, not a
  // line the customer expected to see priced — so anything parenthesised, very
  // long, or listing examples is left out.
  const usable = (v: string) => v.length <= 44 && !/[(),]/.test(v) && !/^\s*$/.test(v);
  const asked = new Set<string>();
  if (args.lead.interest && args.lead.interest !== "Something else" && usable(args.lead.interest)) asked.add(args.lead.interest);
  const need = args.intelligence?.quote_context?.primary_need;
  if (need && usable(need)) asked.add(need);
  for (const c of args.intelligence?.product_context?.capabilities ?? []) if (usable(c.title)) asked.add(c.title);

  const priced = args.items.map((i) => i.description.toLowerCase());
  const covered = (want: string) => {
    const w = want.toLowerCase();
    if (priced.some((p) => p.includes(w) || w.includes(p))) return true;
    // Fall back to significant words, so "Online Listings" is covered by
    // "Listings sync — 60 agents" without needing the exact phrase.
    const words = w.split(/[^a-z]+/).filter((t) => t.length > 4);
    return words.length > 0 && words.every((t) => priced.some((p) => p.includes(t)));
  };

  return [...asked].filter((a) => !covered(a)).slice(0, 4);
}
