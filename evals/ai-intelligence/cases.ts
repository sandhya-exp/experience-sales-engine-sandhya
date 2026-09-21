import type { Activity, Company, Contact, Lead, LeadStatus, Qualification } from "@/lib/types";
import type { DealBriefContext } from "@/lib/ai/dealBrief";

/**
 * Evaluation set for AI Opportunity Intelligence.
 *
 * Realistic opportunities at different stages, each with the facts we expect
 * the workflow to find, the qualification gaps it must report, the knowledge
 * documents it should retrieve, and the readiness verdict it must reach. The
 * runner (run.ts) also applies generic checks to every case: no invented
 * figures, no pricing language, every citation resolvable.
 */
export interface EvalCase {
  name: string;
  ctx: DealBriefContext;
  expect: {
    /** Labels that must appear in gaps.missing. */
    missing: string[];
    /** Labels that must NOT appear in gaps.missing. */
    notMissing?: string[];
    ready: boolean;
    /** Knowledge-base ids that must be among the retrieved documents. */
    retrieved: string[];
    /** Substrings that must appear somewhere in the brief's text (case-insensitive). */
    mentions?: string[];
    /** Substrings that must NOT appear anywhere in the brief's text. */
    forbids?: string[];
    /** Expected integrations extracted. */
    integrations?: string[];
    deployment?: string | null;
    /** Topics that must appear in intelligence.contradictions. */
    contradictions?: string[];
    /** Dynamic gap labels (with a recommended question) that must appear in gaps.missing. */
    questions?: string[];
    nextActionIncludes?: string;
    /** The chain's Gap step must mention this. */
    chainGapIncludes?: string;
  };
}

let counter = 0;
const id = (p: string) => `${p}-${String(++counter).padStart(4, "0")}`;
const NOW = new Date("2026-09-20T10:00:00Z");
const ago = (days: number, hours = 0) => new Date(NOW.getTime() - (days * 24 + hours) * 3600_000).toISOString();
const ahead = (days: number, hours = 0) => new Date(NOW.getTime() + (days * 24 + hours) * 3600_000).toISOString();

function company(name: string, industry: string | null, domain: string): Company {
  return { id: id("co"), name, industry, domain, created_at: ago(10) };
}
function contact(c: Company, name: string, email: string, opts: Partial<Contact> = {}): Contact {
  return { id: id("ct"), company_id: c.id, name, email, phone: null, title: null, is_primary: false, created_at: ago(10), ...opts };
}
function lead(c: Company, primary: Contact | null, fields: Partial<Lead> & { status: LeadStatus; qualification?: Qualification }): Lead {
  return {
    id: id("ld"),
    company_id: c.id,
    primary_contact_id: primary?.id ?? null,
    owner_user_id: null,
    number_of_users: null,
    interest: null,
    requirements: null,
    additional_info: null,
    qualification: {},
    qualification_status: "not_started",
    quote_requested_at: null,
    created_at: ago(3),
    updated_at: ago(0, 1),
    ...fields,
  };
}
function activity(l: Lead, type: Activity["type"], body: string | null, occurred_at: string, extra: Partial<Activity> = {}): Activity {
  return { id: id("ac"), lead_id: l.id, type, body, actor_user_id: null, actor_name: "Sandhya", metadata: {}, occurred_at, ...extra };
}

export function buildCases(): EvalCase[] {
  const cases: EvalCase[] = [];

  // 1. Brand-new dental inquiry: rich text, nothing qualified yet.
  {
    const co = company("Harbor Dental Group", "Dental", "harbordental.com");
    const maya = contact(co, "Maya Patel", "maya@harbordental.com", { title: "Practice Manager", is_primary: true });
    const ld = lead(co, maya, {
      status: "new",
      number_of_users: 120,
      interest: "Surveys & Feedback",
      requirements: "We run 9 dental clinics and need patient surveys after every visit, review generation on Google, and a dashboard per clinic. We use Dentrix today.",
      additional_info: "Decision expected within 2 months. Dr. Maya Patel signs off.",
    });
    const acts = [activity(ld, "note", "Inbound from website inquiry form.", ago(0, 2), { actor_name: "System" })];
    cases.push({
      name: "New dental inquiry (unqualified)",
      ctx: { lead: ld, company: co, contacts: [maya], activities: acts },
      expect: {
        missing: ["Decision timeline", "Decision maker", "Budget range", "Current solution"],
        notMissing: ["User count", "Primary need", "Primary contact"],
        ready: false,
        retrieved: ["cap-surveys-feedback", "int-healthcare-dental"],
        mentions: ["Harbor Dental", "9 dental clinics"],
        integrations: ["Dentrix"],
        deployment: "9 dental clinics",
        contradictions: [],
        questions: ["Users per location unclear", "Reporting needs unspecified"],
      },
    });
  }

  // 2. Fully qualified real-estate deal with a booked follow-up — ready.
  {
    const co = company("BrightPath Realty", "Real Estate", "brightpathrealty.com");
    const dana = contact(co, "Dana Kim", "dana@brightpathrealty.com", { title: "Broker / Owner", is_primary: true });
    const it = contact(co, "Luis Ortega", "luis@brightpathrealty.com", { title: "Operations Lead" });
    const ld = lead(co, dana, {
      status: "qualified",
      number_of_users: 60,
      interest: "Online Listings",
      requirements: "Want to sync listing data from the MLS and manage reviews for 12 agents.",
      qualification: { number_of_users: 60, current_solution: "Manual spreadsheets", primary_need: "Online Listings", decision_timeline: "Within 1 month", decision_maker: "Dana Kim", budget: "$15k/year" },
      qualification_status: "qualified",
    });
    const acts = [
      activity(ld, "email", "Sent listing-sync overview; Dana confirmed she can sign off.", ago(2)),
      activity(ld, "call", "Intro call with Dana — 12 agents, listings tracked in spreadsheets and reviews go unanswered.", ago(5)),
    ];
    cases.push({
      name: "Qualified real-estate deal (ready)",
      ctx: { lead: ld, company: co, contacts: [dana, it], activities: acts },
      expect: {
        missing: [],
        notMissing: ["Decision maker", "Budget range", "Decision timeline", "User count"],
        ready: true,
        retrieved: ["cap-online-listings", "int-mortgage-real-estate"],
        mentions: ["BrightPath", "12 agents", "Dana Kim"],
        integrations: ["MLS"],
        deployment: "12 agents",
      },
    });
  }

  // 3. Vague enterprise inquiry: integration mentioned but not named; no user count.
  {
    const co = company("Nova Insurance", "Insurance", "novainsurance.com");
    const alex = contact(co, "Alex Brown", "alex.brown@novainsurance.com", { is_primary: true });
    const ld = lead(co, alex, {
      status: "contacted",
      number_of_users: null,
      interest: "Experience Management Platform",
      requirements: "Evaluating for an enterprise rollout across all branch locations. Needs to integrate with our CRM.",
      qualification: { current_solution: "Birdeye" },
      qualification_status: "in_progress",
    });
    const acts = [
      activity(ld, "email", "Sent intro email and asked which CRM they run.", ago(4)),
      activity(ld, "note", "Follow-up call", ago(2), { metadata: { kind: "follow_up", title: "Follow-up call", scheduled_for: ago(2), source: "rep" } }),
    ];
    cases.push({
      name: "Vague enterprise inquiry (integration unnamed)",
      ctx: { lead: ld, company: co, contacts: [alex], activities: acts },
      expect: {
        missing: ["User count", "Decision timeline", "Decision maker", "Budget range", "Required integration"],
        notMissing: ["Current solution", "Primary contact"],
        ready: false,
        retrieved: ["cap-experience-management-platform", "int-crm-general"],
        mentions: ["Nova Insurance", "all branch locations"],
        integrations: [],
        deployment: "all branch locations",
        contradictions: [],
        questions: ["Required integration"],
      },
    });
  }

  // 4. Restaurant group with POS named; one gap left (decision maker).
  {
    const co = company("Copperleaf Kitchens", "Restaurants", "copperleaf.com");
    const sam = contact(co, "Sam Rivera", "sam@copperleaf.com", { title: "Marketing Director", is_primary: true });
    const ld = lead(co, sam, {
      status: "contacted",
      number_of_users: 35,
      interest: "Reputation Management",
      requirements: "7 restaurants on Toast. We want to ask every guest for a Google review after they pay and get a Slack alert on anything under 4 stars.",
      qualification: { number_of_users: 35, primary_need: "Reputation Management", decision_timeline: "Before the holiday season", budget: "Around $1k per month", current_solution: "Nothing today" },
      qualification_status: "in_progress",
    });
    const acts = [activity(ld, "call", "Sam walked through the 7 locations; owner Priya Desai approves spend, Sam will introduce her.", ago(1))];
    cases.push({
      name: "Restaurant group (one gap: decision maker)",
      ctx: { lead: ld, company: co, contacts: [sam], activities: acts },
      expect: {
        missing: ["Decision maker"],
        notMissing: ["User count", "Budget range", "Decision timeline"],
        ready: false,
        retrieved: ["cap-reputation-management", "int-hospitality-retail", "qual-decision-maker"],
        mentions: ["Copperleaf", "7 restaurants"],
        integrations: ["Slack", "Toast"],
        deployment: "7 restaurants",
      },
    });
  }

  // 5. Won deal — nothing should be recommended beyond onboarding, still no pricing.
  {
    const co = company("Summit Care Clinics", "Healthcare", "summitcare.health");
    const priya = contact(co, "Priya Patel", "priya@summitcare.health", { is_primary: true });
    const anil = contact(co, "Dr. Anil Mehta", "anil.mehta@summitcare.health", { title: "Medical Director" });
    const ld = lead(co, priya, {
      status: "won",
      number_of_users: 30,
      interest: "Surveys & Feedback",
      requirements: "Patient satisfaction surveys across 4 clinic locations.",
      qualification: { number_of_users: 30, current_solution: "Paper surveys at front desk", primary_need: "Post-visit patient satisfaction surveys with per-location reporting", decision_timeline: "Before Q4 board review", decision_maker: "Dr. Anil Mehta, Medical Director", budget: "$12k/year approved" },
      qualification_status: "qualified",
    });
    const acts = [activity(ld, "note", "Quote accepted by Dr. Mehta. Kickoff scheduled with the onboarding team.", ago(9))];
    cases.push({
      name: "Won healthcare deal",
      ctx: { lead: ld, company: co, contacts: [priya, anil], activities: acts },
      expect: {
        missing: [],
        ready: true,
        retrieved: ["cap-surveys-feedback"],
        mentions: ["Summit Care", "onboarding"],
        integrations: [],
        deployment: "4 clinic locations",
      },
    });
  }

  // 6. Adversarial: the inquiry text itself asks for pricing and names a competitor's price.
  {
    const co = company("Lotus Corp", "Professional Services", "lotuscorp.io");
    const ravi = contact(co, "Ravi Menon", "ravi@lotuscorp.io", { is_primary: true });
    const ld = lead(co, ravi, {
      status: "new",
      number_of_users: 15,
      interest: "Reviews Monitoring",
      requirements: "Just tell us the price per user. Podium quoted us 4000 a year. We have 3 offices.",
      additional_info: "Book a discovery call next week.",
    });
    const acts = [activity(ld, "note", "Discovery call", ahead(5), { metadata: { kind: "follow_up", title: "Discovery call", scheduled_for: ahead(5), source: "customer" } })];
    cases.push({
      name: "Adversarial pricing request",
      ctx: { lead: ld, company: co, contacts: [ravi], activities: acts },
      expect: {
        missing: ["Decision timeline", "Decision maker", "Budget range", "Current solution"],
        ready: false,
        retrieved: ["cap-reviews-monitoring"],
        mentions: ["Lotus Corp"],
        // The brief may say the customer asked about pricing; it must never state or imply one.
        forbids: ["per user", "we can offer", "our price", "discount", "package"],
        integrations: [],
        deployment: "3 offices",
      },
    });
  }

  // 7. Conflicting record: inquiry says 5,000 users, qualification says 3,500; decision maker named in the inquiry differs.
  {
    const co = company("Meridian Mortgage", "Mortgage", "meridianmortgage.com");
    const jo = contact(co, "Jordan Blake", "jordan@meridianmortgage.com", { title: "SVP Operations", is_primary: true });
    const ld = lead(co, jo, {
      status: "contacted",
      number_of_users: 5000,
      interest: "Reputation Management",
      requirements: "Review requests at closing for every loan officer across 40 branches, pulling closings from Encompass. Need a dashboard per region.",
      additional_info: "Our CEO Marcus Hale signs off on this.",
      qualification: { number_of_users: 3500, primary_need: "Reputation Management", decision_timeline: "Q1 next year", decision_maker: "Jordan Blake", budget: "Not yet approved, roughly 100k", current_solution: "Birdeye" },
      qualification_status: "in_progress",
    });
    const acts = [activity(ld, "call", "Discovery with Jordan — 3500 active LOs, Encompass is the LOS, wants regional dashboards.", ago(1))];
    cases.push({
      name: "Conflicting user count and decision maker",
      ctx: { lead: ld, company: co, contacts: [jo], activities: acts },
      expect: {
        missing: [],
        notMissing: ["User count", "Decision maker"],
        ready: false,
        retrieved: ["cap-reputation-management", "int-mortgage-real-estate"],
        mentions: ["5000 users", "3500 users", "Marcus Hale"],
        integrations: ["Encompass"],
        deployment: "40 branches",
        contradictions: ["User count", "Decision maker"],
        questions: ["Reporting needs unspecified"],
      },
    });
  }

  // 8. The enterprise HRIS chain: HR system + 5,000 employees, everything qualified except the HRIS itself.
  {
    const co = company("Northwind Logistics", "Professional Services", "northwindlogistics.com");
    const elena = contact(co, "Elena Ruiz", "elena.ruiz@northwindlogistics.com", { title: "VP People Operations", is_primary: true });
    const cfo = contact(co, "Daniel Osei", "daniel.osei@northwindlogistics.com", { title: "CFO" });
    const ld = lead(co, elena, {
      status: "contacted",
      number_of_users: 5000,
      interest: "Experience Management Platform",
      requirements: "We need to connect our HR system and support 5,000 employees across our depots so every driver and dispatcher gets a customer feedback page and managers see results by region.",
      additional_info: "Rollout would start with the Northeast region. Procurement and IT security will need to review.",
      qualification: { number_of_users: 5000, current_solution: "Nothing today", primary_need: "Experience Management Platform", decision_timeline: "By end of Q4", decision_maker: "Daniel Osei, CFO", budget: "Budget line approved for FY27; amount not shared" },
      qualification_status: "in_progress",
    });
    const acts = [activity(ld, "call", "Intro call with Elena — confirmed 5,000 employees, phased rollout starting Northeast; CFO Daniel Osei approves spend.", ago(1))];
    cases.push({
      name: "Enterprise HRIS chain (only the HRIS is missing)",
      ctx: { lead: ld, company: co, contacts: [elena, cfo], activities: acts },
      expect: {
        missing: ["Required integration"],
        notMissing: ["User count", "Decision maker", "Budget range", "Decision timeline", "Current solution"],
        ready: false,
        retrieved: ["int-hris-enterprise", "qp-enterprise-implementation", "cap-experience-management-platform"],
        mentions: ["Northwind", "5000 users", "Which HRIS are you currently using?", "HRIS"],
        integrations: [],
        deployment: null,
        contradictions: [],
        questions: ["Required integration"],
        nextActionIncludes: "HRIS",
        chainGapIncludes: "HRIS",
      },
    });
  }

  // 9. The mortgage chain (the seeded demo lead): LOS integration expected but not named; everything else qualified.
  {
    const co = company("Meridian Home Loans", "Mortgage", "meridianhomeloans.com");
    const elena = contact(co, "Elena Ruiz", "elena.ruiz@meridianhomeloans.com", { title: "SVP Marketing", is_primary: true });
    const cfo = contact(co, "Daniel Osei", "daniel.osei@meridianhomeloans.com", { title: "CFO" });
    const ld = lead(co, elena, {
      status: "contacted",
      number_of_users: 1200,
      interest: "Reputation Management",
      requirements: "We need to connect our loan origination system so every one of our 1,200 loan officers across 85 branches gets a review request out to the borrower at closing, with a review page per LO and results by region for branch managers.",
      additional_info: "Rollout would start with the Northeast region. Compliance will need to review the outreach wording.",
      qualification: { number_of_users: 1200, current_solution: "Nothing today — LOs ask for reviews by hand", primary_need: "Reputation Management", decision_timeline: "By end of Q4", decision_maker: "Daniel Osei, CFO", budget: "Budget line approved for FY27; amount not shared" },
      qualification_status: "in_progress",
    });
    const acts = [activity(ld, "call", "Intro call with Elena — confirmed 1,200 LOs across 85 branches, phased rollout starting Northeast; CFO Daniel Osei approves spend.", ago(1))];
    cases.push({
      name: "Mortgage LOS chain (only the LOS is missing)",
      ctx: { lead: ld, company: co, contacts: [elena, cfo], activities: acts },
      expect: {
        missing: ["Required integration"],
        notMissing: ["User count", "Decision maker", "Budget range", "Decision timeline", "Current solution"],
        ready: false,
        retrieved: ["int-mortgage-real-estate", "cap-reputation-management", "qp-enterprise-implementation"],
        mentions: ["Meridian Home Loans", "85 branches", "Which loan origination system are you using"],
        integrations: [],
        deployment: "85 branches",
        contradictions: [],
        questions: ["Required integration"],
        nextActionIncludes: "loan origination system",
        chainGapIncludes: "loan origination system",
      },
    });
  }

  return cases;
}

export { NOW as EVAL_NOW };
