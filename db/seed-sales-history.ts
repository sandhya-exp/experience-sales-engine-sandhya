/* DEMO SEED DATA — customer deal history for the Sales Engine agent.
 *
 * Adds accounts with won deals (renewals, expansions) built from the
 * Experience.com sales examples, plus one open opportunity: Planet Home
 * Lending's renewal, pulled forward. Every record is marked seed: true and
 * carries source "Demo seed data" — it is illustrative, not live company data.
 * Domains use the reserved .example TLD so nothing can ever email a real
 * company from this data.
 *
 * Idempotent: an account that already exists (by domain) is skipped.
 * Additive: it never truncates or touches existing data.
 *
 * Run: npx tsx db/seed-sales-history.ts   (uses DATABASE_URL from .env.local,
 * or pass DATABASE_URL=... to seed a hosted database)
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import { randomUUID } from "crypto";
import { getPool, query } from "@/lib/db";
import { getProduct } from "@/lib/catalog/catalog";
import { DEAL_HISTORY_KIND, type DealHistoryMeta, type DealType } from "@/lib/repo/salesHistory";

const SOURCE = "Demo seed data — based on Experience.com sales examples, not live company records";

interface SeedDeal {
  deal_type: DealType;
  products: { code: string; quantity?: number }[];
  acv: number | null;
  arr_change?: number | null;
  term_months: number | null;
  closed_at: string;
  start_date?: string | null;
  end_date?: string | null;
  auto_renewal?: boolean;
  notes?: string;
  users?: number;
}

interface SeedAccount {
  name: string;
  domain: string;
  industry: string;
  contact: { name: string; email: string; title: string };
  deals: SeedDeal[];
  open?: {
    users: number;
    interest: string;
    requirements: string;
    qualification: Record<string, string | number>;
  };
}

const ACCOUNTS: SeedAccount[] = [
  {
    name: "Planet Home Lending",
    domain: "planethomelending.example",
    industry: "Mortgage",
    contact: { name: "Dana Whitfield", email: "dana.whitfield@planethomelending.example", title: "VP, Customer Experience" },
    deals: [
      { deal_type: "new", products: [{ code: "SRP550", quantity: 180 }], acv: null, term_months: 12, closed_at: "2024-06-14", start_date: "2024-07-01", end_date: "2025-06-30", users: 180, notes: "Initial purchase on SRP550. ACV not recorded in the demo data." },
      { deal_type: "expansion", products: [{ code: "SRP850", quantity: 180 }, { code: "VOCE-ENT", quantity: 1 }], acv: null, arr_change: 45000, term_months: null, closed_at: "2025-03-11", notes: "Upgraded SRP550 → SRP850 and added VOCE Enterprise; approximately $45K ARR expansion." },
      { deal_type: "renewal", products: [{ code: "SRP-ENT-PLUS", quantity: 120 }, { code: "SRP-ENT", quantity: 80 }, { code: "VOCE-ENT", quantity: 1 }], acv: 139400, term_months: 12, closed_at: "2025-12-15", start_date: "2026-01-01", end_date: "2026-12-31", users: 200, notes: "1-year renewal on SRP Enterprise Plus + SRP Enterprise + VOCE Enterprise." },
    ],
    open: {
      users: 200,
      interest: "Reputation Management",
      requirements: "Renewal pulled forward from December. Keep SRP Enterprise Plus, SRP Enterprise and VOCE Enterprise for all 200 users. Asking for an 18% discount in exchange for renewing early.",
      qualification: { number_of_users: 200, current_solution: "SRP Enterprise Plus + SRP Enterprise + VOCE Enterprise (current contract to 31 Dec 2026)", primary_need: "Renew current products early", decision_timeline: "Wants to sign by end of October", decision_maker: "Dana Whitfield, VP Customer Experience", budget: "Around $135k/year" },
    },
  },
  { name: "HMA Mortgage", domain: "hmamortgage.example", industry: "Mortgage", contact: { name: "Luis Ortega", email: "luis.ortega@hmamortgage.example", title: "Director of Operations" }, deals: [{ deal_type: "renewal", products: [{ code: "SRP-ENT" }], acv: 32000, term_months: 12, closed_at: "2026-08-20", start_date: "2026-09-01", end_date: "2027-08-31", notes: "1-year renewal." }] },
  { name: "Gulf Coast Real Estate Group", domain: "gulfcoastregroup.example", industry: "Real Estate", contact: { name: "Mara Jennings", email: "mara.jennings@gulfcoastregroup.example", title: "Broker Owner" }, deals: [{ deal_type: "renewal", products: [{ code: "SRP-ENT-PLUS" }, { code: "VOCE-ENT", quantity: 1 }], acv: 17280, term_months: 12, closed_at: "2026-07-09", start_date: "2026-07-15", end_date: "2027-07-14", notes: "1-year renewal." }] },
  { name: "Happy Home Mortgage", domain: "happyhomemortgage.example", industry: "Mortgage", contact: { name: "Priya Raman", email: "priya.raman@happyhomemortgage.example", title: "Marketing Manager" }, deals: [{ deal_type: "renewal", products: [{ code: "SRP-ENT-PLUS" }], acv: 2160, term_months: 12, closed_at: "2026-06-02", start_date: "2026-06-15", end_date: "2027-06-14", notes: "1-year renewal." }] },
  { name: "Presidential Bank Mortgage", domain: "presidentialbankmortgage.example", industry: "Mortgage", contact: { name: "Grant Holloway", email: "grant.holloway@presidentialbankmortgage.example", title: "SVP Retail Lending" }, deals: [{ deal_type: "expansion", products: [{ code: "LISTINGS" }], acv: 5200, term_months: 12, closed_at: "2026-05-18", start_date: "2026-06-01", end_date: "2027-05-31", notes: "1-year expansion adding Listings." }] },
  { name: "Central Trust Bank", domain: "centraltrustbank.example", industry: "Financial Services", contact: { name: "Elaine Porter", email: "elaine.porter@centraltrustbank.example", title: "Head of Client Experience" }, deals: [{ deal_type: "renewal", products: [{ code: "CX", quantity: 1 }], acv: 39150, term_months: 12, closed_at: "2026-04-01", start_date: "2026-04-01", end_date: "2027-03-31", auto_renewal: true, notes: "1-year auto-renewal." }] },
  { name: "First Federal Bank", domain: "firstfederalbank.example", industry: "Financial Services", contact: { name: "Owen Castillo", email: "owen.castillo@firstfederalbank.example", title: "Branch Network Director" }, deals: [{ deal_type: "expansion", products: [{ code: "SRP550-E", quantity: 37 }], acv: 12300, term_months: 12, closed_at: "2026-09-03", start_date: "2026-09-15", end_date: "2027-09-14", users: 37, notes: "Expansion: +37 users on SRP550-E." }] },
];

async function main() {
  const pool = getPool();
  const owner = (await query<{ id: string; name: string }>(`select id, name from app_users where email = 'sandhya@experience.com'`))[0] ?? (await query<{ id: string; name: string }>(`select id, name from app_users order by created_at limit 1`))[0];
  if (!owner) throw new Error("No app user found — run the main seed first.");

  for (const acct of ACCOUNTS) {
    const exists = await query(`select id from companies where domain = $1`, [acct.domain]);
    if (exists.length) {
      console.log(`skip  ${acct.name} (already seeded)`);
      continue;
    }
    const [company] = await query<{ id: string }>(`insert into companies (name, domain, industry) values ($1, $2, $3) returning id`, [acct.name, acct.domain, acct.industry]);
    const [contact] = await query<{ id: string }>(
      `insert into contacts (company_id, name, email, title, is_primary) values ($1, $2, $3, $4, true) returning id`,
      [company.id, acct.contact.name, acct.contact.email, acct.contact.title]
    );

    for (const d of acct.deals) {
      const products = d.products.map((p) => {
        const prod = getProduct(p.code);
        if (!prod) throw new Error(`Unknown product ${p.code}`);
        return { code: prod.code, name: prod.name, quantity: p.quantity ?? null };
      });
      const label = `${d.deal_type === "new" ? "New" : d.deal_type === "renewal" ? "Renewal" : "Expansion"}: ${products.map((p) => p.name).join(" + ")}`;
      const closed = `${d.closed_at}T15:00:00Z`;
      const [lead] = await query<{ id: string }>(
        `insert into leads (company_id, primary_contact_id, owner_user_id, number_of_users, interest, requirements, status, qualification_status, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $6, 'won', 'qualified', $7::timestamptz - interval '30 days', $7::timestamptz) returning id`,
        [company.id, contact.id, owner.id, d.users ?? null, label, d.notes ?? null, closed]
      );
      const meta: DealHistoryMeta = {
        kind: DEAL_HISTORY_KIND,
        deal_type: d.deal_type,
        products,
        acv: d.acv,
        arr_change: d.arr_change ?? null,
        term_months: d.term_months,
        closed_at: d.closed_at,
        start_date: d.start_date ?? null,
        end_date: d.end_date ?? null,
        auto_renewal: d.auto_renewal ?? false,
        notes: d.notes ?? null,
        source: SOURCE,
        seed: true,
      };
      const valueLabel = d.acv != null ? ` · ACV $${d.acv.toLocaleString("en-US")}` : d.arr_change != null ? ` · ARR +$${d.arr_change.toLocaleString("en-US")}` : "";
      await query(
        `insert into activities (lead_id, type, body, actor_name, metadata, occurred_at) values ($1, 'note', $2, 'Demo seed', $3::jsonb, $4)`,
        [lead.id, `${label}${valueLabel} (demo seed data)`, JSON.stringify(meta), closed]
      );
      // The accepted quote the deal closed on, so revenue and deal-size reports
      // count it. Its single line is the historical contract value — named so
      // it can never be matched to a catalog product or read as a list price.
      const value = d.acv ?? d.arr_change;
      if (value != null) {
        const sentAt = `${d.closed_at}T12:00:00Z`;
        const quote = {
          kind: "quote",
          quote_id: randomUUID(),
          version: 1,
          status: "accepted",
          currency: "USD",
          line_items: [{ description: `Historical contract value (${d.deal_type}, demo seed data)`, quantity: 1, unit_price: value, discount_pct: 0 }],
          subtotal: value,
          discount_total: 0,
          discount_pct: 0,
          total: value,
          net_amount: value,
          start_date: d.start_date ?? null,
          term_months: d.term_months,
          end_date: d.end_date ?? null,
          terms: null,
          valid_until: d.closed_at,
          notes: "Demo seed data — historical deal value, not a price.",
          review: { ok: true, issues: [], needs_approval: false, checked_at: sentAt },
          approvals: [],
          superseded: false,
          seed: true,
          history: [
            { status: "created", at: sentAt, by: "Demo seed" },
            { status: "sent", at: sentAt, by: "Demo seed" },
            { status: "accepted", at: closed, by: "Demo seed" },
          ],
          created_by: "Demo seed",
        };
        await query(`insert into activities (lead_id, type, body, actor_name, metadata, occurred_at) values ($1, 'note', $2, 'Demo seed', $3::jsonb, $4)`, [
          lead.id,
          `Quote v1 accepted (demo seed data).`,
          JSON.stringify(quote),
          sentAt,
        ]);
      }
      await query(
        `insert into activities (lead_id, type, body, actor_name, metadata, occurred_at) values ($1, 'status_change', 'Status changed to Won.', 'Demo seed', $2::jsonb, $3)`,
        [lead.id, JSON.stringify({ from: "quoted", to: "won", seed: true }), closed]
      );
    }

    if (acct.open) {
      const [lead] = await query<{ id: string }>(
        `insert into leads (company_id, primary_contact_id, owner_user_id, number_of_users, interest, requirements, status, qualification, qualification_status)
         values ($1, $2, $3, $4, $5, $6, 'qualified', $7::jsonb, 'qualified') returning id`,
        [company.id, contact.id, owner.id, acct.open.users, acct.open.interest, acct.open.requirements, JSON.stringify(acct.open.qualification)]
      );
      await query(`insert into activities (lead_id, type, body, actor_name, metadata) values ($1, 'note', $2, 'Demo seed', $3::jsonb)`, [
        lead.id,
        "Renewal opportunity opened early at the customer's request (demo seed data).",
        JSON.stringify({ seed: true }),
      ]);
      console.log(`open  ${acct.name} renewal → /leads/${lead.id}`);
    }
    console.log(`added ${acct.name} (${acct.deals.length} deal${acct.deals.length === 1 ? "" : "s"})`);
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
