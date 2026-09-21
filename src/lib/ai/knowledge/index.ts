/**
 * Sales Knowledge Base — the reference material the AI Opportunity Intelligence
 * workflow retrieves BEFORE it reasons about an opportunity.
 *
 * These are sales-enablement notes, not a product catalogue: they describe the
 * capability areas a prospect can express interest in (the same list as the
 * inquiry form), the integrations prospects most often ask about by industry,
 * how the team qualifies an opportunity, and what Quote Ready needs to
 * receive. They deliberately contain NO pricing, packages, tiers or discounts —
 * that is Quote Ready's domain, downstream of this module.
 *
 * Every document has a stable id so the AI can cite it and the evaluator can
 * verify that anything cited was actually retrieved.
 */
export type KnowledgeCategory = "capability" | "integration" | "qualification" | "quote_prep";

export interface KnowledgeDoc {
  id: string;
  title: string;
  category: KnowledgeCategory;
  /** Extra retrieval hooks: industries, synonyms, product names. */
  tags: string[];
  content: string;
}

export const SALES_KNOWLEDGE: KnowledgeDoc[] = [
  /* ------------------------------------------------------------ capabilities */
  {
    id: "cap-experience-management-platform",
    title: "Experience Management Platform",
    category: "capability",
    tags: ["experience management", "XMP", "platform", "surveys", "reviews", "reputation", "listings", "multi-location", "enterprise", "dashboard", "reporting"],
    content:
      "The full Experience.com platform combines customer feedback collection, review generation and monitoring, online listings and reporting in one place. It is the usual fit when a prospect wants more than one capability, operates several locations or teams, or asks for a single dashboard across sites. Multi-location deployments need location hierarchy and per-location reporting confirmed during qualification.",
  },
  {
    id: "cap-reputation-management",
    title: "Reputation Management",
    category: "capability",
    tags: ["reputation", "reviews", "review generation", "review requests", "google reviews", "review response", "ratings", "star rating"],
    content:
      "Reputation Management helps a business request reviews from customers after an interaction, monitor new reviews across public review sites and respond to them from one place. Prospects typically care about: which review sites matter to them (Google Business Profile is nearly always one), who responds to reviews, and whether requests should go out automatically after a transaction. Confirm the trigger source for review requests — it usually depends on an integration with the system that records the transaction.",
  },
  {
    id: "cap-surveys-feedback",
    title: "Surveys & Feedback",
    category: "capability",
    tags: ["surveys", "feedback", "NPS", "CSAT", "patient satisfaction", "post-visit", "SMS survey", "email survey", "response rate"],
    content:
      "Surveys & Feedback collects structured feedback (for example post-visit or post-transaction surveys, NPS/CSAT style questions) by email or SMS and reports results by location, team or individual. Typical qualification questions: what event should trigger the survey, which channel (SMS vs email) the customer base responds to, whether results need to be compared across locations, and who acts on negative feedback. Prospects replacing paper or manual surveys usually care most about response rate and closing the loop on poor scores.",
  },
  {
    id: "cap-online-listings",
    title: "Online Listings",
    category: "capability",
    tags: ["listings", "business listings", "directories", "NAP", "google business profile", "local SEO", "locations", "agents"],
    content:
      "Online Listings keeps a business's public profile information (name, address, phone, hours) consistent across directories and search, for every location or agent. It matters most to multi-location and agent-based businesses (real estate, mortgage, insurance, franchises). Confirm how many locations or individual profiles need managing and where the source-of-truth for that data lives today (spreadsheet, CRM, HR system).",
  },
  {
    id: "cap-reviews-monitoring",
    title: "Reviews Monitoring",
    category: "capability",
    tags: ["monitoring", "reviews", "alerts", "sentiment", "review sites", "consolidate", "notifications"],
    content:
      "Reviews Monitoring consolidates reviews from public sites into one view with alerts on new or negative reviews, so a team can see and act on feedback without checking each site. It is often the entry point for prospects who first ask to 'see all our reviews in one place'. Confirm which sites and how many locations; monitoring is frequently paired with Reputation Management once the team wants to generate and respond to reviews too.",
  },

  /* ------------------------------------------------------------ integrations */
  {
    id: "int-crm-general",
    title: "CRM integrations (HubSpot, Salesforce, Zoho, Pipedrive, Dynamics)",
    category: "integration",
    tags: ["HubSpot", "Salesforce", "Zoho", "Pipedrive", "Dynamics", "CRM", "sync", "contacts", "trigger"],
    content:
      "A CRM is the most common trigger source: a closed deal, completed service or stage change in the CRM starts a review request or survey. When a prospect names a CRM, capture (1) which object/event should trigger outreach, (2) whether contact data should sync back, and (3) who owns the CRM admin. Scope and availability of a specific connector must be confirmed with solutions engineering before it is written into the quote context — never promise a connector from the inquiry alone.",
  },
  {
    id: "int-mortgage-real-estate",
    title: "Mortgage & real-estate systems (Encompass, other LOS, MLS, Zillow)",
    category: "integration",
    tags: ["Encompass", "LOS", "loan origination", "Calyx", "Byte", "MeridianLink", "Blend", "Total Expert", "MLS", "Zillow", "mortgage", "lender", "real estate", "loan officer", "loan officers", "borrower", "agents", "closing", "closings", "funded", "branches"],
    content:
      "In mortgage the loan origination system (LOS) — Encompass most often, also Calyx, Byte, MeridianLink and others — records the funded or closed loan, which is the natural moment to ask the borrower for a review and to attribute it to the loan officer and branch. In real estate the MLS or listing data plays the same role for agents. Confirm which LOS the lender runs (it changes the integration approach), the number of loan officers or agents (this is usually the real 'user count'), whether each LO needs an individual review page, which event (closing vs. funding) should trigger outreach, and how branches and regions are organised for reporting. An unnamed LOS is a qualification gap, not a detail for later; connector scope is confirmed with solutions engineering before it enters the quote context.",
  },
  {
    id: "int-healthcare-dental",
    title: "Healthcare & dental practice systems (Epic, Cerner, Dentrix, Open Dental)",
    category: "integration",
    tags: ["Epic", "Cerner", "Dentrix", "Open Dental", "healthcare", "dental", "clinic", "patient", "appointment", "EHR", "PMS", "HIPAA"],
    content:
      "Healthcare and dental prospects want surveys and review requests triggered after an appointment recorded in their practice-management or EHR system. Ask which system records completed visits, whether patient contact data can be used for outreach under their privacy policy, and whether per-clinic or per-provider reporting is required. Data-handling questions should be routed to the security/compliance review rather than answered from the sales side.",
  },
  {
    id: "int-hospitality-retail",
    title: "Hospitality, retail & services POS (Toast, Square, Shopify, Mindbody)",
    category: "integration",
    tags: ["Toast", "Square", "Shopify", "Mindbody", "restaurants", "retail", "e-commerce", "salon", "gym", "POS", "order", "checkout"],
    content:
      "For restaurants, retail, salons and gyms the point-of-sale or booking system is the natural trigger for a post-purchase survey or review request. Confirm which system holds the transaction, how many locations run it, and whether customers' contact details are captured at checkout — without them outreach cannot be automated.",
  },
  {
    id: "int-hris-enterprise",
    title: "HRIS & employee-system integrations (Workday, BambooHR, ADP, SuccessFactors, UKG)",
    category: "integration",
    tags: ["HRIS", "HR system", "HR platform", "Workday", "BambooHR", "ADP", "SuccessFactors", "UKG", "Rippling", "Gusto", "Paycom", "employees", "employee", "headcount", "provisioning", "SSO", "directory", "enterprise"],
    content:
      "When a prospect wants to 'connect our HR system', the HRIS is normally the source of truth for who the users are: it provisions people (employees, agents, providers) and their locations or teams into the platform so profiles, review pages and reporting hierarchies stay current without manual upkeep. Capture (1) which HRIS they run — Workday, BambooHR, ADP, SAP SuccessFactors, UKG, Rippling and similar come up most, (2) whether the employee count they quote is the number of platform users or the whole company headcount, and (3) whether single sign-on is expected alongside provisioning. The specific HRIS changes the implementation approach, so an unnamed HRIS is a qualification gap, not a detail for later. Connector scope and availability are confirmed with solutions engineering before they enter the quote context.",
  },
  {
    id: "qp-enterprise-implementation",
    title: "Enterprise implementation guidance (1,000+ users)",
    category: "quote_prep",
    tags: ["enterprise", "large", "thousands", "employees", "rollout", "phased", "security review", "SSO", "procurement", "stakeholders", "IT", "compliance", "pilot"],
    content:
      "Opportunities in the thousands of users behave differently from a single-location sale: expect a security and data-handling review, IT and procurement as stakeholders alongside the business sponsor, a phased rollout (often a pilot region or department first) and an integration for user provisioning rather than manual user creation. Before Quote Ready, confirm the provisioning source (usually the HRIS), the rollout sequence, who owns the security review and who signs — the business sponsor who submitted the inquiry frequently is not the signer. These points shape the implementation plan that accompanies the quote; the quote itself is still built in Quote Ready.",
  },
  {
    id: "int-messaging-automation",
    title: "Messaging & automation (Slack, Zapier)",
    category: "integration",
    tags: ["Slack", "Zapier", "notifications", "alerts", "automation", "workflow"],
    content:
      "Slack is typically requested for alerting a team when a negative review or low survey score arrives. Zapier-style automation comes up when the prospect's transaction system has no direct connector. Both are secondary to the main trigger integration and rarely change the deal scope, but should be noted so Quote Ready can include them in the solution description.",
  },

  /* ------------------------------------------------------------ qualification */
  {
    id: "qual-user-count",
    title: "Qualifying the user count",
    category: "qualification",
    tags: ["users", "seats", "licence", "agents", "locations", "headcount", "quantity"],
    content:
      "The user count on an inquiry is a customer estimate. Before Quote Ready it must be confirmed and disambiguated: does 'users' mean staff who log in, front-line people who appear on review pages (agents, loan officers, providers), or the number of locations? Multi-location prospects should give both the location count and the users per location. Licence quantity is the single biggest driver of the quote, so an unconfirmed count blocks readiness.",
  },
  {
    id: "qual-decision-maker",
    title: "Identifying the decision maker",
    category: "qualification",
    tags: ["decision maker", "signer", "authority", "approval", "budget owner", "champion"],
    content:
      "The decision maker is the person with authority to approve the purchase and sign — often not the person who submitted the inquiry. Confirm on the first call: who approves spend at this level, who else is involved (IT, operations, compliance) and whether the contact is a champion or the signer. Quote Ready uses the decision maker as the signer for the contract step, so a missing or wrong decision maker stalls approval.",
  },
  {
    id: "qual-timeline-budget",
    title: "Decision timeline and budget context",
    category: "qualification",
    tags: ["timeline", "urgency", "budget", "fiscal year", "board", "renewal date", "competitor contract"],
    content:
      "Timeline sets quote validity and urgency: ask what is driving the date (a competitor contract ending, a board or fiscal deadline, a new-location opening). Budget is captured as context only — a range or an approval ceiling the customer has stated. It is passed to Quote Ready as background and never becomes a price, package or discount in this module. If the customer has not stated a budget, record it as missing rather than estimating one.",
  },
  {
    id: "qual-current-solution",
    title: "Current solution and replacement risk",
    category: "qualification",
    tags: ["current solution", "incumbent", "replacing", "competitor", "migration", "Birdeye", "Podium", "manual", "spreadsheets", "paper"],
    content:
      "Knowing what the prospect uses today (a competing platform, manual spreadsheets, paper surveys, nothing) tells the team about migration effort, why they are looking and what 'better' means to them. If a competitor is named, note the contract end date and the specific gap that prompted the inquiry. Do not make claims about the competitor's product; record what the customer said.",
  },
  {
    id: "qual-primary-contact",
    title: "Primary contact and stakeholder map",
    category: "qualification",
    tags: ["contact", "email", "stakeholders", "IT", "operations", "marketing", "multiple contacts"],
    content:
      "A verified primary contact with a working email is required — the quote and contract go to them. Larger deals usually involve several contacts (operations lead, IT/security, marketing, finance). Add each to the opportunity with their role so Quote Ready receives the full stakeholder list rather than a single name.",
  },

  /* --------------------------------------------------------------- quote prep */
  {
    id: "qp-guided-selling-inputs",
    title: "What Quote Ready needs from qualification",
    category: "quote_prep",
    tags: ["guided selling", "handoff", "quote context", "readiness", "inputs", "checklist"],
    content:
      "Quote Ready builds the quote, approval and contract from the quote context this module hands over. The handoff should carry: customer and industry, confirmed user count and deployment scope (locations), primary need and any secondary capabilities, named integrations with their role (trigger source vs. notification), current solution, decision timeline, decision maker (used as signer), budget as stated context, primary contact and the full contact list. Anything unconfirmed should be marked as a gap, not filled with an assumption.",
  },
  {
    id: "qp-no-pricing-here",
    title: "Pricing, packages and discounts are decided in Quote Ready",
    category: "quote_prep",
    tags: ["pricing", "price", "package", "tier", "discount", "quote amount", "boundary"],
    content:
      "This module never states a price, package, tier, discount or quote amount. The quote amount is always 'To be quoted' until Quote Ready sets it. The AI may explain what will affect the quote (user quantity, number of locations, integrations, timeline) but must not estimate figures or recommend a package.",
  },
  {
    id: "qp-multi-location",
    title: "Preparing a multi-location opportunity",
    category: "quote_prep",
    tags: ["multi-location", "locations", "branches", "clinics", "offices", "stores", "rollout", "phased", "hierarchy"],
    content:
      "Multi-location deals need the location count, the users per location, whether every location goes live at once or in phases, and who administers locations centrally. These details change quantities and the implementation plan, so they belong in the quote context before the handoff. A pilot at a subset of locations is common — if the customer mentions one, record the pilot scope separately from the full rollout.",
  },
];

export function getKnowledgeDoc(id: string): KnowledgeDoc | undefined {
  return SALES_KNOWLEDGE.find((d) => d.id === id);
}
