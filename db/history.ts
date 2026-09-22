/**
 * Twelve months of closed and in-flight demo history.
 *
 * The six hand-written opportunities in `seed.ts` are the *live* demo: they are
 * mid-flight, they have AI briefs, and the agent has something to do on them.
 * They cannot, by themselves, answer a sales manager's questions — what did we
 * close this year, how big is an average deal, how often does a quote turn into
 * a win, how long does it take. Those need history, and history is what this
 * file writes.
 *
 * Everything here goes into the existing tables in the existing shapes:
 * companies, contacts, leads, activities. Quotes are `activities` rows with
 * `metadata.kind = "quote"`, exactly as the product writes them; stage moves are
 * `status_change` rows with `from`/`to`, exactly as `updateLeadStatus` writes
 * them. No new table, no new column, no migration — the metrics layer reads the
 * same rows a real year of selling would have left behind.
 *
 * The data is deterministic (no randomness) so the demo reads the same every
 * time it is seeded, and every company is fictional and clearly a demo account.
 * AI briefs are deliberately *not* generated for these: they are finished deals,
 * a brief on them would be noise, and it keeps the seed fast.
 */
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import type { QuoteLineItem, QuoteMeta, QuoteStatus } from "@/lib/repo/quotes";
import { computeTotals } from "@/lib/repo/quotes";

type Outcome = "won" | "lost" | "quoted" | "qualified";

interface DemoDeal {
  company: string;
  domain: string;
  industry: string;
  contact: string;
  title: string;
  users: number;
  interest: string;
  /** Per-user annual list price for the line item. */
  unitPrice: number;
  discountPct: number;
  /** Days before today the inquiry arrived. */
  startedDaysAgo: number;
  /** Days from inquiry to close (or to today, for open deals). */
  cycleDays: number;
  outcome: Outcome;
  /** Which seeded rep owns it: 0 = Sandhya (most of the book), 1 = Sadhana, 2 = Marcus. */
  owner: 0 | 1 | 2;
  /** Why it was lost — only read for `outcome: "lost"`. */
  lostReason?: string;
  /**
   * How far a lost deal got before it died. Most losses happen after a quote,
   * but plenty never reach one — those are what give the funnel its shape.
   * Defaults to "quoted".
   */
  lostAt?: "contacted" | "qualified" | "quoted";
}

/**
 * Twenty-eight opportunities spread across the last twelve months. The mix is
 * deliberately ordinary rather than flattering: roughly three wins for every
 * two losses, cycles from a fortnight to five months, and deal sizes from a
 * four-clinic practice to a national brokerage.
 */
const DEALS: DemoDeal[] = [
  // ---- Closed won -------------------------------------------------------
  { company: "Harbourline Mortgage", domain: "harbourlinemortgage.com", industry: "Mortgage", contact: "Ruth Calloway", title: "VP Marketing", users: 340, interest: "Reputation Management", unitPrice: 180, discountPct: 10, startedDaysAgo: 375, cycleDays: 44, outcome: "won", owner: 0 },
  { company: "Cedar & Vine Realty", domain: "cedarvinerealty.com", industry: "Real Estate", contact: "Tomas Alvarez", title: "Managing Broker", users: 85, interest: "Online Listings", unitPrice: 240, discountPct: 5, startedDaysAgo: 338, cycleDays: 41, outcome: "won", owner: 1 },
  { company: "Pinegrove Dental Group", domain: "pinegrovedental.com", industry: "Dental", contact: "Dr. Naomi Okafor", title: "Practice Director", users: 45, interest: "Surveys & Feedback", unitPrice: 260, discountPct: 0, startedDaysAgo: 320, cycleDays: 28, outcome: "won", owner: 2 },
  { company: "Keystone Insurance Partners", domain: "keystoneinsurance.co", industry: "Insurance", contact: "Gerald Whitmore", title: "Chief Marketing Officer", users: 620, interest: "Experience Management Platform", unitPrice: 155, discountPct: 12, startedDaysAgo: 305, cycleDays: 96, outcome: "won", owner: 0 },
  { company: "Northgate Auto Group", domain: "northgateauto.com", industry: "Automotive", contact: "Bianca Ferraro", title: "Director of Guest Experience", users: 210, interest: "Reviews Monitoring", unitPrice: 190, discountPct: 8, startedDaysAgo: 286, cycleDays: 52, outcome: "won", owner: 1 },
  { company: "Willowbrook Family Clinics", domain: "willowbrookclinics.health", industry: "Healthcare", contact: "Dr. Samuel Reyes", title: "Chief Medical Officer", users: 130, interest: "Surveys & Feedback", unitPrice: 215, discountPct: 5, startedDaysAgo: 268, cycleDays: 63, outcome: "won", owner: 2 },
  { company: "Ambler & Cross LLP", domain: "amblercross.legal", industry: "Legal", contact: "Priscilla Nand", title: "Head of Business Development", users: 70, interest: "Reputation Management", unitPrice: 280, discountPct: 0, startedDaysAgo: 247, cycleDays: 35, outcome: "won", owner: 0 },
  { company: "Sunbelt Home Services", domain: "sunbelthomeservices.com", industry: "Home Services", contact: "Derek Mbeki", title: "Operations Director", users: 165, interest: "Online Listings", unitPrice: 175, discountPct: 10, startedDaysAgo: 224, cycleDays: 44, outcome: "won", owner: 1 },
  { company: "Lakeshore Credit Union", domain: "lakeshorecu.org", industry: "Financial Services", contact: "Hana Volkov", title: "VP Member Experience", users: 480, interest: "Experience Management Platform", unitPrice: 160, discountPct: 14, startedDaysAgo: 203, cycleDays: 88, outcome: "won", owner: 0 },
  { company: "Verdant Wellness Studios", domain: "verdantwellness.fit", industry: "Gyms & Fitness", contact: "Marcus Idowu", title: "Franchise Director", users: 95, interest: "Reviews Monitoring", unitPrice: 200, discountPct: 5, startedDaysAgo: 181, cycleDays: 30, outcome: "won", owner: 2 },
  { company: "Copperfield Hotels", domain: "copperfieldhotels.com", industry: "Hotels & Hospitality", contact: "Isabelle Tran", title: "Group Guest Relations Lead", users: 275, interest: "Surveys & Feedback", unitPrice: 185, discountPct: 9, startedDaysAgo: 159, cycleDays: 71, outcome: "won", owner: 1 },
  { company: "Ridgeway Realty Collective", domain: "ridgewayrealty.com", industry: "Real Estate", contact: "Owen Petrossian", title: "Principal Broker", users: 120, interest: "Online Listings", unitPrice: 230, discountPct: 6, startedDaysAgo: 134, cycleDays: 38, outcome: "won", owner: 0 },
  { company: "Brightwater Financial", domain: "brightwaterfinancial.com", industry: "Financial Services", contact: "Clara Lindqvist", title: "Head of Client Experience", users: 390, interest: "Reputation Management", unitPrice: 170, discountPct: 11, startedDaysAgo: 112, cycleDays: 57, outcome: "won", owner: 2 },
  { company: "Foxglove Salons", domain: "foxglovesalons.com", industry: "Salons & Spas", contact: "Yasmin Abdi", title: "Owner", users: 40, interest: "Reviews Monitoring", unitPrice: 245, discountPct: 0, startedDaysAgo: 86, cycleDays: 45, outcome: "won", owner: 0 },
  { company: "Stonebridge Academy Trust", domain: "stonebridgetrust.edu", industry: "Education", contact: "Nathaniel Osei", title: "Director of Admissions", users: 150, interest: "Surveys & Feedback", unitPrice: 195, discountPct: 7, startedDaysAgo: 64, cycleDays: 43, outcome: "won", owner: 0 },
  { company: "Talloak Property Group", domain: "talloakproperty.com", industry: "Real Estate", contact: "Freya Nilsen", title: "Head of Sales", users: 110, interest: "Online Listings", unitPrice: 225, discountPct: 5, startedDaysAgo: 41, cycleDays: 26, outcome: "won", owner: 2 },

  // ---- Closed lost ------------------------------------------------------
  { company: "Elmstead Insurance Brokers", domain: "elmsteadbrokers.com", industry: "Insurance", contact: "Colin Beaumont", title: "Marketing Manager", users: 200, interest: "Reputation Management", unitPrice: 180, discountPct: 5, startedDaysAgo: 331, cycleDays: 61, outcome: "lost", owner: 0, lostReason: "Went with an incumbent vendor already bundled into their agency management system." },
  { company: "Ironvale Manufacturing", domain: "ironvalemfg.com", industry: "Professional Services", contact: "Dieter Kraus", title: "Head of Customer Success", users: 260, interest: "Experience Management Platform", unitPrice: 165, discountPct: 8, startedDaysAgo: 294, cycleDays: 83, outcome: "lost", owner: 0, lostReason: "Budget pulled when the parent group froze new software spend for the year." },
  { company: "Marlow Street Dental", domain: "marlowstreetdental.com", industry: "Dental", contact: "Dr. Ingrid Sahoo", title: "Principal Dentist", users: 25, interest: "Surveys & Feedback", unitPrice: 265, discountPct: 0, startedDaysAgo: 256, cycleDays: 34, outcome: "lost", owner: 2, lostReason: "Too small for a paid programme this year; asked us to re-approach at renewal." },
  { company: "Cobalt Legal Services", domain: "cobaltlegal.com", industry: "Legal", contact: "Rashid Haleem", title: "Partner", users: 55, interest: "Reputation Management", unitPrice: 275, discountPct: 0, startedDaysAgo: 212, cycleDays: 47, outcome: "lost", owner: 0, lostReason: "No internal owner for the programme once the sponsoring partner left." },
  { company: "Greenline Restaurants", domain: "greenlinerestaurants.com", industry: "Restaurants", contact: "Sofia Marchetti", title: "Brand Director", users: 180, interest: "Reviews Monitoring", unitPrice: 185, discountPct: 15, startedDaysAgo: 168, cycleDays: 55, outcome: "lost", owner: 0, lostReason: "Chose a cheaper point solution after a competitive discount we could not match." },
  { company: "Hartwell Motors", domain: "hartwellmotors.com", industry: "Automotive", contact: "Janine Prosser", title: "Group Marketing Lead", users: 145, interest: "Online Listings", unitPrice: 190, discountPct: 10, startedDaysAgo: 121, cycleDays: 39, outcome: "lost", owner: 2, lostReason: "Timeline slipped past their fiscal year; opportunity closed as no-decision." },
  { company: "Quill & Bramble Retail", domain: "quillbramble.com", industry: "Retail & E-commerce", contact: "Ade Fashola", title: "Head of Digital", users: 90, interest: "Reviews Monitoring", unitPrice: 210, discountPct: 5, startedDaysAgo: 73, cycleDays: 32, outcome: "lost", owner: 0, lostReason: "Decided to build review aggregation in-house on their existing data platform." },

  // ---- Closed lost before a quote ---------------------------------------
  // Real funnels narrow at every step, not just at the end. These never got a
  // proposal: the conversation stopped at first contact or at qualification.
  { company: "Ashgrove Letting Agents", domain: "ashgrovelettings.com", industry: "Real Estate", contact: "Peter Nwosu", title: "Branch Manager", users: 35, interest: "Online Listings", unitPrice: 230, discountPct: 0, startedDaysAgo: 344, cycleDays: 11, outcome: "lost", owner: 0, lostAt: "contacted", lostReason: "Never got past the first call — no budget holder would engage." },
  { company: "Pemberton Financial Group", domain: "pembertonfg.com", industry: "Financial Services", contact: "Adaora Eze", title: "Marketing Lead", users: 120, interest: "Reputation Management", unitPrice: 175, discountPct: 0, startedDaysAgo: 277, cycleDays: 23, outcome: "lost", owner: 0, lostAt: "qualified", lostReason: "Qualified, then paused indefinitely pending a wider CRM replacement." },
  { company: "Silverbeck Hotels", domain: "silverbeckhotels.com", industry: "Hotels & Hospitality", contact: "Ruben Castillo", title: "Operations Manager", users: 60, interest: "Surveys & Feedback", unitPrice: 220, discountPct: 0, startedDaysAgo: 231, cycleDays: 9, outcome: "lost", owner: 2, lostAt: "contacted", lostReason: "Enquiry was research only; no project and no timeline." },
  { company: "Oakfield Veterinary", domain: "oakfieldvet.com", industry: "Healthcare", contact: "Dr. Mei Lin", title: "Practice Manager", users: 28, interest: "Reviews Monitoring", unitPrice: 240, discountPct: 0, startedDaysAgo: 196, cycleDays: 18, outcome: "lost", owner: 0, lostAt: "qualified", lostReason: "Went quiet after qualification; three follow-ups unanswered." },
  { company: "Castlereagh Legal", domain: "castlereaghlegal.com", industry: "Legal", contact: "Fiona Bright", title: "Practice Director", users: 48, interest: "Reputation Management", unitPrice: 270, discountPct: 0, startedDaysAgo: 143, cycleDays: 13, outcome: "lost", owner: 0, lostAt: "contacted", lostReason: "Wanted a free tool; not a fit for a paid programme." },
  { company: "Larkspur Fitness", domain: "larkspurfitness.com", industry: "Gyms & Fitness", contact: "Dominic Reyes", title: "Regional Manager", users: 75, interest: "Reviews Monitoring", unitPrice: 205, discountPct: 0, startedDaysAgo: 97, cycleDays: 20, outcome: "lost", owner: 2, lostAt: "qualified", lostReason: "Qualified but the sponsor changed role and the project lapsed." },
  { company: "Merrow Dental Care", domain: "merrowdental.com", industry: "Dental", contact: "Dr. Josef Lang", title: "Owner", users: 22, interest: "Surveys & Feedback", unitPrice: 255, discountPct: 0, startedDaysAgo: 56, cycleDays: 8, outcome: "lost", owner: 0, lostAt: "contacted", lostReason: "Single-site practice; referred to self-serve instead." },

  // ---- Open: quote out, awaiting the customer ---------------------------
  { company: "Alderton Wealth Advisors", domain: "aldertonwealth.com", industry: "Financial Services", contact: "Margot Delacroix", title: "COO", users: 230, interest: "Experience Management Platform", unitPrice: 170, discountPct: 10, startedDaysAgo: 48, cycleDays: 48, outcome: "quoted", owner: 0 },
  { company: "Westfold Veterinary Group", domain: "westfoldvet.com", industry: "Healthcare", contact: "Dr. Leo Mwangi", title: "Practice Owner", users: 65, interest: "Surveys & Feedback", unitPrice: 235, discountPct: 5, startedDaysAgo: 33, cycleDays: 33, outcome: "quoted", owner: 2 },
  { company: "Pillarstone Property", domain: "pillarstoneproperty.com", industry: "Real Estate", contact: "Anika Roshan", title: "Director of Operations", users: 140, interest: "Online Listings", unitPrice: 220, discountPct: 18, startedDaysAgo: 19, cycleDays: 19, outcome: "quoted", owner: 0 },

  // ---- Open: qualified, no quote yet ------------------------------------
  { company: "Thornbury Hotels & Spa", domain: "thornburyhotels.com", industry: "Hotels & Hospitality", contact: "Ewan Fitzgerald", title: "Regional GM", users: 175, interest: "Reputation Management", unitPrice: 185, discountPct: 0, startedDaysAgo: 27, cycleDays: 27, outcome: "qualified", owner: 0 },
  { company: "Lumen Orthodontics", domain: "lumenortho.com", industry: "Dental", contact: "Dr. Carla Benitez", title: "Clinical Director", users: 50, interest: "Surveys & Feedback", unitPrice: 250, discountPct: 0, startedDaysAgo: 14, cycleDays: 14, outcome: "qualified", owner: 2 },
];

const DAY = 24 * 60 * 60 * 1000;

/** A date `daysAgo` before now, pinned to a business hour so timelines read naturally. */
function at(daysAgo: number, hour = 10, minute = 15) {
  const d = new Date(Date.now() - daysAgo * DAY);
  d.setHours(hour, minute, 0, 0);
  return d;
}

function slug(name: string) {
  return name.toLowerCase().replace(/[^a-z]+/g, ".").replace(/^\.|\.$/g, "");
}

export interface HistoryResult {
  leads: number;
  quotes: number;
  won: number;
  lost: number;
}

export async function seedHistoricalDeals(pool: Pool, ownerIds: [string, string, string]): Promise<HistoryResult> {
  const result: HistoryResult = { leads: 0, quotes: 0, won: 0, lost: 0 };
  const ownerNames: [string, string, string] = ["Sandhya", "Sadhana", "Marcus Lee"];

  for (const deal of DEALS) {
    const ownerId = ownerIds[deal.owner];
    const actor = ownerNames[deal.owner];

    /* ---- company, contact, lead ---------------------------------------- */
    const created = at(deal.startedDaysAgo, 9, 20);
    const { rows: companyRows } = await pool.query<{ id: string }>(
      `insert into companies (name, domain, industry, created_at) values ($1, $2, $3, $4) returning id`,
      [deal.company, deal.domain, deal.industry, created]
    );
    const companyId = companyRows[0].id;

    const email = `${slug(deal.contact)}@${deal.domain}`;
    const { rows: contactRows } = await pool.query<{ id: string }>(
      `insert into contacts (company_id, name, email, phone, title, is_primary, created_at)
       values ($1, $2, $3, $4, $5, true, $6) returning id`,
      [companyId, deal.contact, email, null, deal.title, created]
    );
    const contactId = contactRows[0].id;

    const closed = deal.outcome === "won" || deal.outcome === "lost";
    const finalStatus = deal.outcome === "qualified" ? "qualified" : deal.outcome === "quoted" ? "quoted" : deal.outcome;
    // How far this deal actually got. A loss can end at first contact, at
    // qualification, or after a proposal; only the last of those has a quote.
    const diedAt = deal.outcome === "lost" ? deal.lostAt ?? "quoted" : null;
    const reachedQualified = diedAt !== "contacted";
    const hasQuote = deal.outcome !== "qualified" && reachedQualified && diedAt !== "qualified";
    // Where each step falls between the inquiry and the close.
    const dayAt = (fraction: number) => deal.startedDaysAgo - Math.round(deal.cycleDays * fraction);

    const { rows: leadRows } = await pool.query<{ id: string }>(
      `insert into leads (company_id, primary_contact_id, owner_user_id, number_of_users, interest, requirements,
                          status, qualification, qualification_status, quote_requested_at, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [
        companyId,
        contactId,
        ownerId,
        deal.users,
        deal.interest,
        `${deal.interest} for ${deal.users} users across the ${deal.industry.toLowerCase()} business.`,
        finalStatus,
        reachedQualified
          ? JSON.stringify({
              number_of_users: deal.users,
              current_solution: "Manual process today",
              primary_need: deal.interest,
              decision_timeline: "This quarter",
              decision_maker: `${deal.contact}, ${deal.title}`,
              budget: `Approved, ~${Math.round((deal.users * deal.unitPrice) / 1000)}k/year`,
            })
          : JSON.stringify({ number_of_users: deal.users, primary_need: deal.interest }),
        reachedQualified ? "qualified" : "in_progress",
        hasQuote ? at(dayAt(0.7), 15, 0) : null,
        created,
        at(closed ? deal.startedDaysAgo - deal.cycleDays : 0, 16, 0),
      ]
    );
    const leadId = leadRows[0].id;
    result.leads += 1;

    /* ---- the timeline --------------------------------------------------- */
    const activity = (occurredAt: Date, type: string, body: string, metadata: Record<string, unknown> = {}, actorName = actor) =>
      pool.query(
        `insert into activities (lead_id, type, body, actor_user_id, actor_name, metadata, occurred_at)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [leadId, type, body, type === "status_change" || actorName !== "System" ? ownerId : null, actorName, JSON.stringify(metadata), occurredAt]
      );
    const stage = (occurredAt: Date, from: string, to: string) =>
      activity(occurredAt, "status_change", `Stage changed from ${from} to ${to}.`, { kind: "status_change", from, to });

    await activity(created, "note", "Lead created from customer inquiry.", {}, "System");
    await activity(at(dayAt(0.08), 11, 30), "call", `Intro call with ${deal.contact.split(" ")[0]} — confirmed ${deal.users} users and the ${deal.interest.toLowerCase()} requirement.`);
    await stage(at(dayAt(0.08), 11, 45), "new", "contacted");
    await activity(at(dayAt(0.25), 14, 10), "email", `Sent ${deal.interest.toLowerCase()} overview and a ${deal.industry.toLowerCase()} case study.`);
    if (reachedQualified) {
      await activity(at(dayAt(0.45), 10, 0), "qualification_change", "Qualification updated — requirement, timeline, decision maker and budget captured.", { kind: "qualification_change" });
      await stage(at(dayAt(0.45), 10, 5), "contacted", "qualified");
    }

    /* ---- the quote ------------------------------------------------------ */
    if (hasQuote) {
      const items: QuoteLineItem[] = [
        { description: `${deal.interest} — ${deal.users} users`, quantity: deal.users, unit_price: deal.unitPrice, discount_pct: deal.discountPct },
      ];
      const totals = computeTotals(items);
      const createdAt = at(dayAt(0.7), 15, 0);
      const sentAt = at(dayAt(0.75), 9, 30);
      const closeAt = at(deal.startedDaysAgo - deal.cycleDays, 16, 0);
      const approved = deal.discountPct > 15;

      const status: QuoteStatus = deal.outcome === "won" ? "accepted" : deal.outcome === "lost" ? "expired" : "sent";
      const history: QuoteMeta["history"] = [
        { status: "created", at: createdAt.toISOString(), by: actor },
        ...(approved ? [{ status: "approved" as const, at: at(dayAt(0.73), 11, 0).toISOString(), by: "Sandhya" }] : []),
        { status: "sent" as const, at: sentAt.toISOString(), by: actor },
        ...(deal.outcome === "won" ? [{ status: "accepted" as const, at: closeAt.toISOString(), by: deal.contact }] : []),
        ...(deal.outcome === "lost" ? [{ status: "expired" as const, at: closeAt.toISOString(), by: "System", note: deal.lostReason }] : []),
      ];

      const meta: QuoteMeta = {
        kind: "quote",
        quote_id: randomUUID(),
        version: 1,
        status,
        currency: "USD",
        line_items: items,
        subtotal: totals.subtotal,
        discount_total: totals.discount_total,
        total: totals.total,
        discount_pct: totals.discount_pct,
        terms: "Annual subscription, billed annually. Net 30.",
        // Open quotes stay valid; closed ones carry the date they were written against.
        valid_until: new Date((closed ? closeAt.getTime() : Date.now() + 21 * DAY)).toISOString().slice(0, 10),
        notes: null,
        review: { ok: !approved, issues: approved ? [`Discount of ${totals.discount_pct}% exceeds the 15% approval threshold.`] : [], needs_approval: approved, checked_at: createdAt.toISOString() },
        superseded: false,
        history,
        created_by: actor,
      };

      await activity(createdAt, "note", `Quote v1 created — ${money(meta.total)}, valid until ${meta.valid_until}.`, meta as unknown as Record<string, unknown>);
      await activity(sentAt, "email", `Quote v1 sent to ${deal.contact}.`, { kind: "quote_event", quote_id: meta.quote_id, version: 1, to: "sent" });
      await stage(sentAt, "qualified", "quoted");
      result.quotes += 1;
    }

    /* ---- the close ------------------------------------------------------ */
    if (deal.outcome === "won") {
      const closeAt = at(deal.startedDaysAgo - deal.cycleDays, 16, 0);
      await activity(closeAt, "note", `${deal.contact} accepted quote v1. Handed to onboarding.`);
      await stage(closeAt, "quoted", "won");
      result.won += 1;
    } else if (deal.outcome === "lost") {
      const closeAt = at(deal.startedDaysAgo - deal.cycleDays, 16, 0);
      await activity(closeAt, "note", `Closed lost. ${deal.lostReason}`);
      await stage(closeAt, diedAt ?? "quoted", "lost");
      result.lost += 1;
    }
  }

  return result;
}

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}
