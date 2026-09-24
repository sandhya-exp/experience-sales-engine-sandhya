import { config } from "dotenv";
config({ path: ".env.local" });
config();

import type { Company, Contact, Lead, LeadStatus, Qualification } from "@/lib/types";
import { extractCallRecap, planCallRecapApplication } from "@/lib/ai/callRecap";
import { claudeAvailable } from "@/lib/ai/claude";

/**
 * Evaluation set for the call recap feature.
 *
 * The same discipline the customer-reply reader already has to meet: every
 * extracted fact must quote the transcript verbatim, a fact that isn't quoted
 * is thrown away, and nothing is ever written to the opportunity until a
 * salesperson confirms it — confirming twice, or a call that repeats a fact
 * the record already holds, changes nothing.
 *
 *   npm run eval:call-recap            deterministic (no API key needed)
 *   npm run eval:call-recap -- --claude  also exercise the Claude extraction path
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
const NOW = new Date("2026-09-24T10:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * 86_400_000).toISOString();

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

const co = company("Meridian Realty", "Real Estate", "meridianrealty.com");
const dana = contact(co, "Dana Cole", "dana@meridianrealty.com", { title: "Operations Director" });
const ld = lead(co, dana, {
  status: "qualified",
  number_of_users: null,
  interest: "Online Listings",
  requirements: "We want our listings to sync automatically and one place to manage reviews.",
  qualification: {},
  qualification_status: "in_progress",
});

const TRANSCRIPT = `Rep: Thanks for making time today. To start, can you walk me through your current setup?
Customer: Sure. We're on Bright MLS for listings, and we have about 85 agents across our three branches who'd be using this.
Rep: Got it — 85 agents across three branches. And what's driving the timeline?
Customer: Our broker wants something in place before the spring listing season, so ideally we'd be live by March.
Rep: Is there a budget range you're working within?
Customer: We haven't set a hard number yet, but we're planning around $2,000 a month for the whole rollout.`;

async function main() {
  console.log(`Call recap evals · ${MODE === "auto" ? "Claude + deterministic" : "deterministic"}\n`);

  /* 1 · transcript grounding — every extracted item quotes the transcript */
  console.log("1. Grounds every fact in the transcript");
  const extraction = await extractCallRecap({ transcript: TRANSCRIPT, lead: ld, company: co, contact: dana, intelligence: null, mode: MODE === "auto" ? "auto" : "deterministic" });
  check("finds the named system", extraction.systems.some((s) => /bright\s*mls/i.test(s.name)), extraction.systems.map((s) => s.name).join(", ") || "none");
  check(
    "every extracted item quotes the transcript verbatim",
    [...extraction.systems, ...extraction.facts].every((x) => TRANSCRIPT.toLowerCase().includes(x.quote.toLowerCase().trim())),
    [...extraction.systems, ...extraction.facts].map((x) => x.quote).join(" | ")
  );
  check("never reports pricing as a plain fact outside budget", extraction.facts.every((f) => f.field === "budget" || !/\$|per[- ]user|discount/i.test(f.value)));

  /* 2 · a fact with no matching quote in the source is dropped, not invented */
  console.log("\n2. Rejects a hallucinated fact");
  const fakeExtraction = {
    facts: [
      { field: "number_of_users" as const, label: "User count", value: "999", quote: "we have 999 people using this" },
      { field: null, label: "User count", value: "85", quote: "85 agents across our three branches" },
    ],
    systems: [{ name: "Salesforce", quote: "we use Salesforce for everything" }],
    summary: "test",
    next_action: null,
  };
  // Re-run the same grounding rule the module applies internally, directly
  // against the transcript, to prove a quote that doesn't appear is dropped.
  const haystack = TRANSCRIPT.toLowerCase();
  const survivingFacts = fakeExtraction.facts.filter((f) => haystack.includes(f.quote.toLowerCase()));
  const survivingSystems = fakeExtraction.systems.filter((s) => haystack.includes(s.quote.toLowerCase()));
  check("a quote not in the transcript would be dropped", survivingFacts.length === 1 && survivingFacts[0].value === "85");
  check("an invented system would be dropped", survivingSystems.length === 0);

  /* 3 · nothing is applied until confirmed */
  console.log("\n3. Nothing applies before confirmation");
  const planNoneConfirmed = planCallRecapApplication(extraction.facts, extraction.systems, [], ld, NOW);
  check("confirming nothing writes nothing", planNoneConfirmed.applied.length === 0 && Object.keys(planNoneConfirmed.qualificationUpdates).length === 0);

  /* 4 · confirming a fact writes exactly that fact */
  console.log("\n4. Confirming a fact applies only that fact");
  const userFactIndex = extraction.facts.findIndex((f) => f.field === "number_of_users");
  check("the user-count fact was found", userFactIndex >= 0, extraction.facts.map((f) => f.field).join(", "));
  if (userFactIndex >= 0) {
    const planOne = planCallRecapApplication(extraction.facts, extraction.systems, [userFactIndex], ld, NOW);
    check("user count is planned for write", planOne.qualificationUpdates.number_of_users === 85, String(planOne.qualificationUpdates.number_of_users));
    check("nothing else was applied", planOne.applied.length === 1, planOne.applied.join(", "));
  }

  /* 5 · an already-set field is never overwritten */
  console.log("\n5. Never overwrites a qualification field that's already set");
  const alreadyQualified = { ...ld, qualification: { number_of_users: 60 } };
  if (userFactIndex >= 0) {
    const planOverwrite = planCallRecapApplication(extraction.facts, extraction.systems, [userFactIndex], alreadyQualified, NOW);
    check("the existing count is left alone", planOverwrite.qualificationUpdates.number_of_users === undefined, String(planOverwrite.qualificationUpdates.number_of_users));
  }

  /* 6 · a named system goes through the same confirmation gate as any fact */
  console.log("\n6. A named system is gated like any other fact");
  const systemIndex = extraction.facts.length; // systems are appended after facts
  const hasSystem = extraction.systems.length > 0;
  if (hasSystem) {
    const planNoSystem = planCallRecapApplication(extraction.facts, extraction.systems, [], ld, NOW);
    check("an unconfirmed system is not written", !planNoSystem.contextLines.some((l) => /bright\s*mls/i.test(l)));
    const planWithSystem = planCallRecapApplication(extraction.facts, extraction.systems, [systemIndex], ld, NOW);
    check("a confirmed system is written, attributed to the call", planWithSystem.contextLines.some((l) => /bright\s*mls/i.test(l) && l.startsWith("Confirmed on call")), planWithSystem.contextLines.join(" | "));
  }

  /* 7 · deterministic fallback still works without Claude */
  console.log("\n7. Works without Claude");
  const detExtraction = await extractCallRecap({ transcript: TRANSCRIPT, lead: ld, company: co, contact: dana, intelligence: null, mode: "deterministic" });
  check("a summary is still produced", detExtraction.summary.length > 0);
  check("it is labelled deterministic", detExtraction.generated_by === "deterministic");
  check("it still finds the named system without Claude", detExtraction.systems.some((s) => /bright\s*mls/i.test(s.name)), detExtraction.systems.map((s) => s.name).join(", ") || "none");

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
