/* Seed realistic demo data for the P0 live demo.
 * Run with: npx tsx db/seed.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
import bcrypt from "bcryptjs";
import { getPool } from "@/lib/db";
import { findOrCreateCompanyForEmail } from "@/lib/repo/companies";
import { createPrimaryContact, addContact } from "@/lib/repo/contacts";
import { createLead, updateLeadStatus, updateQualification, ensureSeedOwnerAssigned } from "@/lib/repo/leads";
import { recordActivity } from "@/lib/repo/activities";
import { scheduleFollowUp } from "@/lib/repo/followups";

function daysFromNowAt(days: number, hour: number, minute: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d;
}
function nextBusinessDayAt(hour: number, minute: number) {
  let d = daysFromNowAt(1, hour, minute);
  while (d.getDay() === 0 || d.getDay() === 6) d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  return d;
}
import { getLeadContextOrThrow, regenerateBriefFor } from "@/lib/ai/service";

async function main() {
  const pool = getPool();

  console.log("Clearing existing demo data...");
  await pool.query("truncate ai_deal_briefs, activities, leads, contacts, companies, app_users cascade");

  console.log("Creating demo user...");
  const passwordHash = await bcrypt.hash("demo1234", 10);
  const { rows: userRows } = await pool.query(
    `insert into app_users (name, email, password_hash, role) values ($1, $2, $3, 'admin') returning id`,
    ["Sandhya", "sandhya@experience.com", passwordHash]
  );
  const ownerId = userRows[0].id as string;

  // Two teammates, so ownership, coverage and sector routing have somewhere to go.
  const { rows: teamRows } = await pool.query(
    `insert into app_users (name, email, password_hash, role) values
       ('Sadhana', 'sadhana@experience.com', $1, 'sales'),
       ('Marcus Lee', 'marcus@experience.com', $1, 'sales')
     returning id, email`,
    [passwordHash]
  );
  const sadhanaId = teamRows.find((r: { email: string }) => r.email === "sadhana@experience.com")!.id as string;

  // --- Acme Corporation: fully qualified, ready for the demo's happy path ---
  const acme = await findOrCreateCompanyForEmail("Acme Corporation", "john@acme.com", "Insurance");
  const acmeContact = await createPrimaryContact(acme.company.id, "John Smith", "john@acme.com", "+1 (415) 555-0123", "VP Customer Experience");
  const acmeLead = await createLead({
    companyId: acme.company.id,
    primaryContactId: acmeContact.id,
    numberOfUsers: 250,
    interest: "Experience Management Platform",
    requirements: "We're looking for surveys and reputation management across 15 branches.",
    additionalInfo: "Currently evaluating alternatives to HubSpot Service Hub.",
  });
  await ensureSeedOwnerAssigned(acmeLead.id, ownerId);
  await addContact(
    acme.company.id,
    { name: "Sarah Johnson", email: "sarah@acme.com", title: "Director of Operations", phone: "+1 415 555 0456" },
    acmeLead.id,
    "Sandhya"
  );
  await addContact(
    acme.company.id,
    { name: "Mike Chen", email: "mike@acme.com", title: "IT Manager", phone: "+1 415 555 0789" },
    acmeLead.id,
    "Sandhya"
  );
  await recordActivity({
    leadId: acmeLead.id,
    type: "call",
    body: "Discussed their requirements. They are looking at a 3 month timeline. Will send additional product information.",
    actorName: "Sandhya",
    metadata: { nextAction: "Send follow-up email with case studies", followUpOn: "2026-09-22" },
  });
  await updateLeadStatus(acmeLead.id, "contacted", "Sandhya");
  await updateQualification(
    acmeLead.id,
    {
      number_of_users: 250,
      current_solution: "HubSpot",
      primary_need: "Surveys and reputation management",
      decision_timeline: "Within 3 months",
      decision_maker: "VP Customer Experience",
      budget: null,
    },
    "in_progress",
    "Sandhya"
  );
  await regenerateBriefFor(await getLeadContextOrThrow(acmeLead.id));

  // --- FinEdge Solutions: new, needs first contact ---
  const finEdge = await findOrCreateCompanyForEmail("FinEdge Solutions", "sarah.thomas@finedge.io", "Financial Services");
  const finEdgeContact = await createPrimaryContact(finEdge.company.id, "Sarah Thomas", "sarah.thomas@finedge.io", "+1 212 555 0111");
  const finEdgeLead = await createLead({
    companyId: finEdge.company.id,
    primaryContactId: finEdgeContact.id,
    numberOfUsers: 80,
    interest: "Reputation Management",
    requirements: "Need to consolidate review monitoring across 6 regional offices.",
  });
  await ensureSeedOwnerAssigned(finEdgeLead.id, ownerId);
  await recordActivity({ leadId: finEdgeLead.id, type: "note", body: "Inbound from website inquiry form.", actorName: "System" });
  // The customer picked a discovery-call slot on the confirmation page.
  await scheduleFollowUp({
    leadId: finEdgeLead.id,
    scheduledFor: nextBusinessDayAt(11, 0),
    title: "Discovery call",
    note: "Booked by the customer from the inquiry confirmation page.",
    actorName: "Sarah Thomas",
    source: "customer",
  });
  await regenerateBriefFor(await getLeadContextOrThrow(finEdgeLead.id));

  // --- Meridian Home Loans: the mortgage chain (retrieval → reasoning → gap → readiness) ---
  const meridian = await findOrCreateCompanyForEmail("Meridian Home Loans", "elena.ruiz@meridianhomeloans.com", "Mortgage");
  const meridianContact = await createPrimaryContact(meridian.company.id, "Elena Ruiz", "elena.ruiz@meridianhomeloans.com", "+1 617 555 0180", "SVP Marketing");
  const meridianLead = await createLead({
    companyId: meridian.company.id,
    primaryContactId: meridianContact.id,
    numberOfUsers: 1200,
    interest: "Reputation Management",
    requirements: "We need to connect our loan origination system so every one of our 1,200 loan officers across 85 branches gets a review request out to the borrower at closing, with a review page per LO and results by region for branch managers.",
    additionalInfo: "Rollout would start with the Northeast region. Compliance will need to review the outreach wording.",
  });
  await ensureSeedOwnerAssigned(meridianLead.id, ownerId);
  await recordActivity({ leadId: meridianLead.id, type: "call", body: "Intro call with Elena — confirmed 1,200 LOs across 85 branches, phased rollout starting Northeast, decision by end of Q4; CFO Daniel Osei approves spend.", actorName: "Sandhya" });
  await updateLeadStatus(meridianLead.id, "contacted", "Sandhya");
  await updateQualification(
    meridianLead.id,
    {
      number_of_users: 1200,
      current_solution: "Nothing today — LOs ask for reviews by hand",
      primary_need: "Reputation Management",
      decision_timeline: "By end of Q4",
      decision_maker: "Daniel Osei, CFO",
      budget: "Budget line approved for FY27; amount not shared",
    },
    "in_progress",
    "Sandhya"
  );
  await addContact(meridian.company.id, { name: "Daniel Osei", email: "daniel.osei@meridianhomeloans.com", title: "CFO" }, meridianLead.id, "Sandhya");
  await regenerateBriefFor(await getLeadContextOrThrow(meridianLead.id));

  // --- Nova Insurance: stalled, needs attention ---
  const nova = await findOrCreateCompanyForEmail("Nova Insurance", "alex.brown@novainsurance.com", "Insurance");
  const novaContact = await createPrimaryContact(nova.company.id, "Alex Brown", "alex.brown@novainsurance.com", "+1 312 555 0199");
  const novaLead = await createLead({
    companyId: nova.company.id,
    primaryContactId: novaContact.id,
    numberOfUsers: 420,
    interest: "Experience Management Platform",
    requirements: "Evaluating for enterprise rollout across all branch locations.",
  });
  await ensureSeedOwnerAssigned(novaLead.id, ownerId);
  await recordActivity({
    leadId: novaLead.id,
    type: "email",
    body: "Sent intro email with pricing overview.",
    actorName: "Sandhya",
  });
  await updateLeadStatus(novaLead.id, "contacted", "Sandhya");
  // A follow-up call was booked for two days ago and nothing has been logged since → "Missed follow-up call".
  await scheduleFollowUp({
    leadId: novaLead.id,
    scheduledFor: daysFromNowAt(-2, 14, 0),
    title: "Follow-up call",
    note: "Walk through pricing tiers for 420 users.",
    actorName: "Sandhya",
    source: "rep",
  });
  await regenerateBriefFor(await getLeadContextOrThrow(novaLead.id));
  // Backdate this lead's activity so it shows up under "Needs Attention"
  await pool.query(
    "update activities set occurred_at = now() - interval '4 days' where lead_id = $1",
    [novaLead.id]
  );

  // --- Two more, further along, for a fuller pipeline ---
  const brightPath = await findOrCreateCompanyForEmail("BrightPath Realty", "dana@brightpathrealty.com", "Real Estate");
  const brightContact = await createPrimaryContact(brightPath.company.id, "Dana Kim", "dana@brightpathrealty.com");
  const brightLead = await createLead({
    companyId: brightPath.company.id,
    primaryContactId: brightContact.id,
    numberOfUsers: 60,
    interest: "Online Listings",
    requirements: "Want to sync listing data and manage reviews for 12 agents.",
  });
  await ensureSeedOwnerAssigned(brightLead.id, sadhanaId);
  await recordActivity({
    leadId: brightLead.id,
    type: "call",
    body: "Intro call with Dana — 12 agents, listings currently tracked in spreadsheets and reviews go unanswered.",
    actorName: "Sandhya",
  });
  await updateLeadStatus(brightLead.id, "contacted", "Sandhya");
  await recordActivity({
    leadId: brightLead.id,
    type: "email",
    body: "Sent listing-sync overview and pricing tiers; Dana confirmed she can sign off up to $15k.",
    actorName: "Sandhya",
  });
  await updateQualification(
    brightLead.id,
    {
      number_of_users: 60,
      current_solution: "Manual spreadsheets",
      primary_need: "Online Listings",
      decision_timeline: "Within 1 month",
      decision_maker: "Dana Kim",
      budget: "$15k/year",
    },
    "qualified",
    "Sandhya"
  );
  await regenerateBriefFor(await getLeadContextOrThrow(brightLead.id));
  await updateLeadStatus(brightLead.id, "quoted", "Sandhya");

  const summitCare = await findOrCreateCompanyForEmail("Summit Care Clinics", "priya@summitcare.health", "Healthcare");
  const summitContact = await createPrimaryContact(summitCare.company.id, "Priya Patel", "priya@summitcare.health");
  const summitLead = await createLead({
    companyId: summitCare.company.id,
    primaryContactId: summitContact.id,
    numberOfUsers: 30,
    interest: "Surveys & Feedback",
    requirements: "Patient satisfaction surveys across 4 clinic locations.",
  });
  await ensureSeedOwnerAssigned(summitLead.id, ownerId);
  await addContact(
    summitCare.company.id,
    { name: "Dr. Anil Mehta", email: "anil.mehta@summitcare.health", title: "Medical Director" },
    summitLead.id,
    "Sandhya"
  );
  await recordActivity({
    leadId: summitLead.id,
    type: "call",
    body: "Discovery call with Priya — 4 locations, currently using paper surveys with ~12% response rate.",
    actorName: "Sandhya",
  });
  await updateLeadStatus(summitLead.id, "contacted", "Sandhya");
  await recordActivity({
    leadId: summitLead.id,
    type: "email",
    body: "Sent case study on clinic survey programs and proposed a demo for the leadership team.",
    actorName: "Sandhya",
  });
  await recordActivity({
    leadId: summitLead.id,
    type: "call",
    body: "Demo with Priya and Dr. Mehta. Strong fit; they want SMS surveys post-visit and a location comparison dashboard.",
    actorName: "Sandhya",
  });
  await updateQualification(
    summitLead.id,
    {
      number_of_users: 30,
      current_solution: "Paper surveys at front desk",
      primary_need: "Post-visit patient satisfaction surveys with per-location reporting",
      decision_timeline: "Before Q4 board review",
      decision_maker: "Dr. Anil Mehta, Medical Director",
      budget: "$12k/year approved",
    },
    "qualified",
    "Sandhya"
  );
  await updateLeadStatus(summitLead.id, "quoted", "Sandhya");
  await recordActivity({
    leadId: summitLead.id,
    type: "note",
    body: "Quote accepted by Dr. Mehta. Kickoff scheduled with the onboarding team.",
    actorName: "Sandhya",
  });
  await updateLeadStatus(summitLead.id, "won", "Sandhya");
  await regenerateBriefFor(await getLeadContextOrThrow(summitLead.id));

  // Spread activity across the past few weeks so the pipeline and the Recent
  // Activity feed read like real work, not a single instant. Each lead's
  // entries keep their relative order (offset by row position within the lead).
  const backdate = async (leadId: string, oldestDaysAgo: number, newestDaysAgo: number) => {
    await pool.query(
      `with ordered as (
         select id, row_number() over (order by occurred_at) - 1 as n, count(*) over () as total
         from activities where lead_id = $1
       )
       update activities a
       set occurred_at = now()
         - make_interval(days => $2::int)
         + (make_interval(days => ($2 - $3)::int) * (o.n::float / greatest(o.total - 1, 1)))
         - make_interval(mins => ((o.total - o.n) * 7)::int)
       from ordered o where o.id = a.id`,
      [leadId, oldestDaysAgo, newestDaysAgo]
    );
    await pool.query(
      "update leads set created_at = (select min(occurred_at) from activities where lead_id = $1) where id = $1",
      [leadId]
    );
  };
  await backdate(summitLead.id, 24, 9);
  await backdate(brightLead.id, 12, 1);
  await backdate(acmeLead.id, 6, 0);
  await backdate(finEdgeLead.id, 0, 0);
  await backdate(novaLead.id, 4, 4); // exactly 4 days stale: the "Needs Attention" example
  await backdate(meridianLead.id, 2, 1);

  console.log("Seed complete.");
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
