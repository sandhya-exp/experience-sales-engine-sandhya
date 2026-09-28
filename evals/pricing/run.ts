import { findProduct, getProduct, getProducts, PRICE_LIST } from "@/lib/catalog/catalog";
import { calculateQuote, validateDiscount } from "@/lib/catalog/pricing";

/**
 * Evaluation set for catalog pricing — the rules the agent's quote tools rely on.
 * Pure functions, no database, no model.
 *
 *   npm run eval:pricing
 */
const verbose = process.argv.includes("--verbose");
let passed = 0;
const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    if (verbose) console.log(`  ✓ ${name}`);
  } else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}
const rules = { managerPct: 15, adminPct: 25 };

console.log("1. Prices come only from the catalog");
const q = calculateQuote([{ product_code: "SRP850", quantity: 100 }, { product_code: "VOCE-ENT", quantity: 7 }], rules);
check("SRP850 priced at its list price", q.lines[0].unit_price === getProduct("SRP850")!.list_price);
check("platform product forced to quantity 1", q.lines[1].quantity === 1, String(q.lines[1].quantity));
check("total = qty × list", q.totals.total === 100 * 420 + 18000, String(q.totals.total));
// A price smuggled into a line is ignored — the type has no price field and the calculation never reads one.
const smuggled = calculateQuote([{ product_code: "SRP850", quantity: 10, ...({ unit_price: 1 } as object) } as never], rules);
check("a price in the input is ignored", smuggled.lines[0].unit_price === 420, String(smuggled.lines[0].unit_price));

console.log("2. Unknown products are reported, never priced");
const u = calculateQuote([{ product_code: "SRP9000", quantity: 5 }], rules);
check("unknown code not priced", u.lines.length === 0 && u.unknown_products.includes("SRP9000"));

console.log("3. Historical ACV is not a price");
check("no catalog price equals a seeded ACV", !getProducts().some((p) => [32000, 17280, 139400, 2160, 5200, 39150, 12300].includes(p.list_price)));
check("price list is labelled demo", PRICE_LIST.is_demo === true);

console.log("4. Discount validation");
check("10% within rep authority", validateDiscount("SRP850", 10, rules).level === "ok");
check("18% needs a manager", validateDiscount("SRP850", 18, rules).level === "manager");
check("above product ceiling needs admin", validateDiscount("LISTINGS", 12, rules).level === "admin");
check("above admin threshold needs admin", validateDiscount(null, 30, rules).level === "admin");
const planet = calculateQuote(
  [{ product_code: "SRP-ENT-PLUS", quantity: 120, discount_pct: 18 }, { product_code: "SRP-ENT", quantity: 80, discount_pct: 18 }, { product_code: "VOCE-ENT", quantity: 1, discount_pct: 18 }],
  rules
);
check("Planet renewal at 18% needs a manager, not an admin", planet.approval === "manager", planet.approval);
check("Planet renewal total is deterministic", planet.totals.total === Math.round((120 * 720 + 80 * 540 + 18000) * 0.82 * 100) / 100, String(planet.totals.total));

console.log("5. Product matching");
check("'SRP Enterprise Plus' is not read as SRP Enterprise", findProduct("SRP Enterprise Plus · Reputation Management")?.code === "SRP-ENT-PLUS");
check("family maps to default product", findProduct("Online Listings")?.code === "LISTINGS");
check("nonsense matches nothing", findProduct("coffee machine") === null);

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  · ${f}`);
  process.exit(1);
}
