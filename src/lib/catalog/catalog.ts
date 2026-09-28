/**
 * Product & price list — the single source of truth for what Sales Engine can
 * quote and at what list price.
 *
 * DEMO PRICE LIST. These are illustrative prices for the prototype, not
 * Experience.com's real commercial terms; every surface that shows them says
 * so. Replacing this file with the real price book (or a pricing service behind
 * the same functions) changes every quote and every AI tool at once, because
 * nothing else in the app holds a price.
 *
 * Two rules this module exists to enforce:
 *   - The AI never invents a price. Every price an agent or a quote sees comes
 *     from `listPrice()` here.
 *   - Historical deal value (ACV) is customer history, never a price. It lives
 *     in the customer-history tools, not in this file, and is never read back
 *     as a list price.
 *
 * Pure data and pure functions, no database — the quote editor imports this in
 * the browser, the server and the MCP endpoint import the same module, so the
 * number a rep sees is the number the agent reasons over.
 */

export const PRICE_LIST = {
  version: "2026.1-demo",
  currency: "USD",
  effective_from: "2026-01-01",
  is_demo: true,
  label: "Demo price list — illustrative, not real Experience.com pricing",
} as const;

export type PricingUnit = "user" | "location" | "platform";

export interface Product {
  code: string;
  name: string;
  /** The customer-facing area this product answers — matches the inquiry form's interests. */
  family: "Reputation Management" | "Experience Management Platform" | "Online Listings" | "Surveys & Feedback" | "Reviews Monitoring";
  unit: PricingUnit;
  billing_period: "year";
  /** List price per unit per billing period. */
  list_price: number;
  /** Deepest discount a rep may request on this product before admin approval is required. */
  max_discount_pct: number;
  description: string;
}

export const PRODUCTS: readonly Product[] = [
  { code: "SRP550", name: "SRP550", family: "Reviews Monitoring", unit: "user", billing_period: "year", list_price: 240, max_discount_pct: 20, description: "Core reputation: review monitoring and response." },
  { code: "SRP550-E", name: "SRP550-E", family: "Reputation Management", unit: "user", billing_period: "year", list_price: 300, max_discount_pct: 20, description: "SRP550 with enterprise controls and reporting." },
  { code: "SRP850", name: "SRP850", family: "Reputation Management", unit: "user", billing_period: "year", list_price: 420, max_discount_pct: 20, description: "Full reputation management: reviews, surveys, social publishing." },
  { code: "SRP-ENT", name: "SRP Enterprise", family: "Reputation Management", unit: "user", billing_period: "year", list_price: 540, max_discount_pct: 20, description: "Enterprise reputation for multi-branch organisations." },
  { code: "SRP-ENT-PLUS", name: "SRP Enterprise Plus", family: "Reputation Management", unit: "user", billing_period: "year", list_price: 720, max_discount_pct: 20, description: "SRP Enterprise with advanced analytics and dedicated success." },
  { code: "VOCE-ENT", name: "VOCE Enterprise", family: "Experience Management Platform", unit: "platform", billing_period: "year", list_price: 18000, max_discount_pct: 20, description: "Experience management platform, enterprise tier." },
  { code: "LISTINGS", name: "Listings", family: "Online Listings", unit: "location", billing_period: "year", list_price: 260, max_discount_pct: 10, description: "Online listings sync and management, per location." },
  { code: "CX", name: "CX", family: "Surveys & Feedback", unit: "platform", billing_period: "year", list_price: 36000, max_discount_pct: 15, description: "Customer experience surveys and feedback programme." },
];

/** The default product to quote for each inquiry interest. */
const DEFAULT_FOR_FAMILY: Record<Product["family"], string> = {
  "Reputation Management": "SRP850",
  "Experience Management Platform": "VOCE-ENT",
  "Online Listings": "LISTINGS",
  "Surveys & Feedback": "CX",
  "Reviews Monitoring": "SRP550",
};

export function getProducts(): readonly Product[] {
  return PRODUCTS;
}

export function getProduct(code: string): Product | null {
  const c = code.trim().toUpperCase();
  return PRODUCTS.find((p) => p.code === c) ?? null;
}

/**
 * The product a free-text line or interest refers to. Exact code or name wins,
 * then a product name contained in the text (longest first, so "SRP Enterprise
 * Plus" is not read as "SRP Enterprise"), then the default for a family name.
 */
export function findProduct(text: string): Product | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  const exact = PRODUCTS.find((p) => p.code.toLowerCase() === t || p.name.toLowerCase() === t);
  if (exact) return exact;
  const byName = [...PRODUCTS].sort((a, b) => b.name.length - a.name.length).find((p) => t.includes(p.name.toLowerCase()) || t.includes(p.code.toLowerCase()));
  if (byName) return byName;
  const family = (Object.keys(DEFAULT_FOR_FAMILY) as Product["family"][]).find((f) => t.includes(f.toLowerCase()));
  return family ? getProduct(DEFAULT_FOR_FAMILY[family]) : null;
}

export function listPrice(code: string): number | null {
  return getProduct(code)?.list_price ?? null;
}

export function unitLabel(unit: PricingUnit): string {
  return unit === "user" ? "per user / year" : unit === "location" ? "per location / year" : "flat / year";
}

/** How a product reads on a quote line, keeping the customer's own words for the area it answers. */
export function lineDescription(p: Product): string {
  return `${p.name} · ${p.family}`;
}
