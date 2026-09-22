import { config } from "dotenv";
config({ path: ".env.local" });
config();

import type { Activity, Company, Contact, Lead, LeadStatus, Qualification } from "@/lib/types";
import { generateDealBrief, type DealBriefContext } from "@/lib/ai/dealBrief";
import { composeCustomerMessage, decideAgentAction, RISK_EXPLANATION } from "@/lib/ai/act";
import { mayRunAutomatically } from "@/lib/ai/actions";
import { extractFromReply, planReplyApplication } from "@/lib/ai/reply";
import { corpusFrom, groundingProblem, inventedProperNouns } from "@/lib/ai/guard";
import { claudeAvailable } from "@/lib/ai/claude";

/**
 * Evaluation set for the agent layer.
 *
 * The existing nine cases (evals/ai-intelligence) check what the pipeline
 * concludes. These check what it DOES about it, and every one of them is a
 * failure a demo would otherwise hide: an action chosen for the wrong reason, a
 * commercial question sent without a person, a message naming a system nobody
 * mentioned, a customer's reply inventing a fact they never stated, or the loop
 * failing to move after new information arrives.
 *
 *   npm run eval:agent            deterministic (no API key needed)
 *   npm run eval:agent -- --claude  also exercise the Claude compose/extract path
 */
const args = new Set(process.argv.slice(2));
const wantClaude = args.has("--claude");
const verbose = args.has("--verbose");
const MODE = wantClaude && claudeAvailable() ? "auto" : "deterministic";

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = "") {
  if (ok) {
    passed++;
    if (verbose) console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/* ------------------------------------------------------------- fixtures */

let n = 0;
const id = (p: string) => `${p}-${String(++n).padStart(4, "0")}`;
const NOW = new Date("2026-09-22T10:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();
const ahead = (hours: number) => new Date(NOW.getTime() + hours * 3_600_000).toISOString();

function company(name: string, industry: string, domain: string): Company {
  return { id: id("co"), name, industry, domain, created_at: ago(20) };
}
function contact(c: Company, name: string, email: string, opts: Partial<Contact> = {}): Contact {
  return { id: id("ct"), company_id: c.id, name, email, phone: null, title: null, is_primary: true, created_at: ago(20), ...opts };
}
function lead(c: Company, primary: Contact, fields: Partial<Lead> & { status: LeadStatus; qualification?: Qualification }): Lead {
  return {
    id: id("ld"),
    company_id: c.id,
    primary_contact_id: primary.id,
    owner_user_id: null,
    number_of_users: null,
    interest: null,
    requirements: null,
    additional_info: null,
    qualification: {},
    qualification_status: "not_started",
    quote_requested_at: null,
    created_at: ago(6),
    updated_at: ago(1),
    ...fields,
  } as Lead;
}
function activity(l: Lead, type: Activity["type"], body: string, at: string, metadata: Record<string, unknown> = {}): Activity {
  return { id: id("ac"), lead_id: l.id, type, body, actor_user_id: null, actor_name: "Sandhya", metadata, occurred_at: at };
}

/** BrightPath Realty: fully qualified, one thing missing — the listing system. */
function brightPath(extraContext?: string): DealBriefContext {
  const co = company("BrightPath Realty", "Real Estate", "brightpathrealty.com");
  const dana = contact(co, "Dana Kim", "dana@brightpathrealty.com", { title: "Broker / Owner" });
  const ld = lead(co, dana, {
    status: "qualified",
    number_of_users: 60,
    interest: "Online Listings",
    requirements: "We need our listing data to sync automatically and one place to manage reviews for our 12 agents. Listings are tracked in spreadsheets today and reviews are going unanswered.",
    additional_info: extraContext ?? null,
    qualification: { number_of_users: 60, current_solution: "Manual spreadsheets", primary_need: "Online Listings", decision_timeline: "Within 1 month", decision_maker: "Dana Kim", budget: "$15k/year" },
    qualification_status: "qualified",
  });
  return {
    lead: ld,
    company: co,
    contacts: [dana],
    activities: [activity(ld, "call", "Intro call with Dana — 12 agents, listings in spreadsheets, reviews unanswered.", ago(5))],
  };
}

/** An early deal where the only gap is the budget — commercial ground. */
function budgetOnlyGap(): DealBriefContext {
  const co = company("Harbor Dental Group", "Healthcare", "harbordental.com");
  const sam = contact(co, "Sam Reyes", "sam@harbordental.com", { title: "Practice Manager" });
  const ld = lead(co, sam, {
    status: "contacted",
    number_of_users: 40,
    interest: "Surveys & Feedback",
    requirements: "Patient satisfaction surveys across our four practices.",
    qualification: { number_of_users: 40, current_solution: "Paper forms", primary_need: "Surveys & Feedback", decision_timeline: "This quarter", decision_maker: "Sam Reyes", budget: null },
    qualification_status: "in_progress",
  });
  return { lead: ld, company: co, contacts: [sam], activities: [activity(ld, "call", "Discovery call held.", ago(3))] };
}

/* ------------------------------------------------------------------ run */

async function main() {
  console.log(`Agent evals · ${MODE === "auto" ? "Claude + deterministic" : "deterministic"}\n`);

  /* 1 · the pipeline finds the missing requirement, and 2 · retrieves knowledge for it */
  const ctx = brightPath();
  const brief = await generateDealBrief(ctx, undefined, { mode: MODE === "auto" ? "auto" : "deterministic", now: NOW });
  const intel = brief.intelligence;
  console.log("1. Understands the opportunity");
  check("identifies the unnamed integration as a gap", intel.gaps.missing.some((m) => m.label === "Required integration"), intel.gaps.missing.map((m) => m.label).join(", ") || "no gaps");
  check("retrieves knowledge for the decision", (intel.process?.retrieved.length ?? 0) > 0, `${intel.process?.retrieved.length ?? 0} documents`);
  check("is not ready while the integration is unknown", intel.readiness?.ready === false, String(intel.readiness?.ready));

  /* 3 · it chooses the right action */
  console.log("\n2. Chooses an action");
  const decision = decideAgentAction({ ...ctx, intelligence: intel, now: NOW });
  check("proposes an action at all", Boolean(decision));
  check("asks the customer rather than inventing an answer", decision?.action_type === "ask_customer", decision?.action_type);
  check("targets the integration gap", decision?.gap_label === "Required integration", String(decision?.gap_label));
  check("the question names the kind of system", /listing|mls/i.test(decision?.question ?? ""), decision?.question ?? "");

  /* 4 · risk banding and the automation rule */
  console.log("\n3. Bands the risk");
  check("a routine factual request is low risk", decision?.risk === "green", String(decision?.risk));
  check("low risk is safe to automate", decision ? mayRunAutomatically(decision.risk) : false);
  const budgetCtx = budgetOnlyGap();
  const budgetBrief = await generateDealBrief(budgetCtx, undefined, { mode: "deterministic", now: NOW });
  const budgetDecision = decideAgentAction({ ...budgetCtx, intelligence: budgetBrief.intelligence, now: NOW });
  check("asking about budget is commercial ground", budgetDecision?.risk === "red", String(budgetDecision?.risk));
  check("commercial actions are never automatic", budgetDecision ? !mayRunAutomatically(budgetDecision.risk) : false);
  check("every band explains itself", Object.values(RISK_EXPLANATION).every((t) => t.length > 20));

  /* 5 · the drafted message is grounded */
  console.log("\n4. Drafts a grounded message");
  const composed = decision
    ? await composeCustomerMessage({
        decision,
        lead: ctx.lead,
        company: ctx.company,
        contact: ctx.contacts[0],
        intelligence: intel,
        senderName: "Sandhya Rao",
        mode: MODE === "auto" ? "auto" : "deterministic",
      })
    : null;
  const message = composed?.message;
  check("a message is produced", Boolean(message?.body));
  check("it greets the actual contact", (message?.body ?? "").includes("Dana"), (message?.body ?? "").slice(0, 40));
  check("it asks about the listing system", /listing|mls/i.test(message?.body ?? ""));
  const corpus = corpusFrom(ctx.lead.requirements, ctx.lead.interest, "60", ctx.company.name, ctx.contacts[0].name, "Sandhya Rao", decision?.question, intel.customer_need);
  check("it invents no figure and no commercial language", groundingProblem(`${message?.subject} ${message?.body}`, corpus) === null, groundingProblem(`${message?.subject} ${message?.body}`, corpus) ?? "");
  check(
    "it names no system the customer never mentioned",
    inventedProperNouns(message?.body ?? "", corpus, ["Dana", "Kim", "BrightPath", "Realty", "Sandhya", "Rao", "Experience.com"]).length === 0,
    inventedProperNouns(message?.body ?? "", corpus, ["Dana", "Kim", "BrightPath", "Realty", "Sandhya", "Rao", "Experience.com"]).join(", ")
  );
  check("it is labelled with how it was written", message?.generated_by === "claude" || message?.generated_by === "deterministic", String(message?.generated_by));
  if (MODE === "auto") check("Claude wrote it when Claude is configured", message?.generated_by === "claude", composed?.note ?? "");

  /* 6 · the guardrail catches what it is for */
  console.log("\n5. Refuses ungrounded content");
  check("pricing language is rejected", groundingProblem("Our pricing starts at a competitive per-user rate.", corpus) !== null);
  check("a commitment is rejected", groundingProblem("We guarantee the integration will be live in two weeks.", corpus) !== null);
  check("an invented figure is rejected", groundingProblem("We can support all 4,500 of your agents.", corpus) !== null);
  check("a fact from the record is accepted", groundingProblem("You mentioned 12 agents and 60 users.", corpusFrom("12 agents", "60 users")) === null);

  /* 7 · the customer's reply is read, and only what they said is kept */
  console.log("\n6. Reads the customer's reply");
  const replyText = "Thanks — we use Bright MLS for all of our listings. Happy to get started once you confirm the sync works.";
  const extraction = await extractFromReply({
    replyText,
    lead: ctx.lead,
    company: ctx.company,
    contact: ctx.contacts[0],
    intelligence: intel,
    mode: MODE === "auto" ? "auto" : "deterministic",
  });
  check("extracts the system the customer named", extraction.systems.some((s) => /bright\s*mls/i.test(s.name)), extraction.systems.map((s) => s.name).join(", ") || "none");
  check("every extracted item quotes the reply", [...extraction.systems, ...extraction.facts].every((x) => replyText.toLowerCase().includes(x.quote.toLowerCase().trim())));
  const plan = planReplyApplication(extraction, ctx.lead, NOW);
  check("plans a write for the named system", plan.contextLines.some((l) => /bright\s*mls/i.test(l)), plan.contextLines.join(" | ") || "none");
  check("attributes the write to the customer", plan.contextLines.every((l) => l.startsWith("Customer confirmed")));

  /* 8 · re-evaluating changes the answer */
  console.log("\n7. Re-evaluates and moves on");
  const after = brightPath(plan.contextLines.join("\n"));
  const afterBrief = await generateDealBrief(after, undefined, { mode: MODE === "auto" ? "auto" : "deterministic", now: NOW });
  const afterIntel = afterBrief.intelligence;
  check("the integration gap is gone", !afterIntel.gaps.missing.some((m) => m.label === "Required integration"), afterIntel.gaps.missing.map((m) => m.label).join(", ") || "no gaps");
  check("the named system is on the record", afterIntel.quote_context.integrations.some((i) => /bright\s*mls/i.test(i)), afterIntel.quote_context.integrations.join(", ") || "none");
  check("readiness improves", (afterIntel.readiness?.checks_passed ?? 0) > (intel.readiness?.checks_passed ?? 0), `${intel.readiness?.checks_passed} → ${afterIntel.readiness?.checks_passed}`);
  const afterDecision = decideAgentAction({ ...after, intelligence: afterIntel, now: NOW });
  check("the next action changes", afterDecision?.goal !== decision?.goal, `${decision?.goal} → ${afterDecision?.goal ?? "none"}`);
  check("nothing is left to ask the customer", afterDecision?.action_type !== "ask_customer", String(afterDecision?.action_type));

  /* 9 · a booked call takes priority and is internal work */
  console.log("\n8. Uses the calendar");
  const withCall = brightPath();
  withCall.activities = [
    ...withCall.activities,
    activity(withCall.lead, "call", "Discovery call booked", ago(0), { kind: "follow_up", title: "Discovery call", scheduled_for: ahead(26) }),
  ];
  const callBrief = await generateDealBrief(withCall, undefined, { mode: "deterministic", now: NOW });
  const callDecision = decideAgentAction({ ...withCall, intelligence: callBrief.intelligence, now: NOW });
  check("prepares for an imminent call first", callDecision?.action_type === "prepare_call", String(callDecision?.action_type));
  check("preparation is internal and low risk", callDecision?.risk === "green" && callDecision?.question === null);

  /* 10 · closed opportunities are left alone */
  console.log("\n9. Knows when to do nothing");
  const won = brightPath();
  won.lead = { ...won.lead, status: "won" };
  check("no action on a won opportunity", decideAgentAction({ ...won, intelligence: intel, now: NOW }) === null);
  const quoted = brightPath();
  quoted.lead = { ...quoted.lead, status: "quoted" };
  check("no action once it has left sales", decideAgentAction({ ...quoted, intelligence: intel, now: NOW }) === null);

  /* 11 · deterministic fallback */
  console.log("\n10. Works without Claude");
  const detBrief = await generateDealBrief(brightPath(), undefined, { mode: "deterministic", now: NOW });
  const detDecision = decideAgentAction({ ...brightPath(), intelligence: detBrief.intelligence, now: NOW });
  const detMessage = detDecision
    ? await composeCustomerMessage({ decision: detDecision, lead: ctx.lead, company: ctx.company, contact: ctx.contacts[0], intelligence: detBrief.intelligence, senderName: "Sandhya Rao", mode: "deterministic" })
    : null;
  check("a decision is still made", detDecision?.action_type === "ask_customer");
  check("a message is still written", Boolean(detMessage?.message.body));
  check("and it is labelled deterministic", detMessage?.message.generated_by === "deterministic");
  check("its wording is grounded too", groundingProblem(detMessage?.message.body ?? "", corpus) === null, groundingProblem(detMessage?.message.body ?? "", corpus) ?? "");

  console.log(`\n${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  · ${f}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
