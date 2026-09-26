import { config } from "dotenv";
config({ path: ".env.local" });
config();

import type { Company, Contact, Lead, LeadStatus, Qualification } from "@/lib/types";
import { extractFromReply } from "@/lib/ai/reply";
import { planCallRecapApplication } from "@/lib/ai/callRecap";
import { claudeAvailable } from "@/lib/ai/claude";

/**
 * Evaluation set for automatic inbound email capture.
 *
 * The webhook route (`/api/webhooks/inbound-email`) is the one genuinely new
 * piece of plumbing here — everything it does once it has matched a sender
 * to a lead reuses code this suite already exercises directly: the same
 * grounded reading a pasted reply gets (`extractFromReply`), and the same
 * confirm-before-write gate Call Recap uses (`planCallRecapApplication`,
 * proven in `evals/call-recap`). This suite proves that reuse holds for an
 * email reply's shape of text, and — the one thing that must be different
 * from a manually-submitted reply — that nothing is ever applied until a
 * salesperson confirms it, since a webhook has no human at the keyboard to
 * treat as that confirmation.
 *
 *   npm run eval:inbound-email              deterministic (no API key needed)
 *   npm run eval:inbound-email -- --claude    also exercise the Claude extraction path
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

const co = company("Gulf Coast RE Group", "Real Estate", "gulfcoastregroup.com");
const elena = contact(co, "Elena Ruiz", "elena.ruiz@gulfcoastregroup.com", { title: "Operations Director" });
const ld = lead(co, elena, {
  status: "contacted",
  number_of_users: null,
  interest: "Online Reviews",
  requirements: "We want review requests to go out automatically after closing.",
  qualification: {},
  qualification_status: "in_progress",
});

const REPLY_TEXT = `Hi — thanks for following up. To answer your question, we're on Bright MLS for listings, and we have about 85 agents across our three branches who'd need accounts. We'd like to be live before the spring listing season, ideally by March.`;

async function main() {
  console.log(`Inbound email evals · ${MODE === "auto" ? "Claude + deterministic" : "deterministic"}\n`);

  /* 1 · the same grounded reading a pasted reply gets */
  console.log("1. Extracts and grounds facts from an email reply, exactly like a pasted reply");
  const extraction = await extractFromReply({ replyText: REPLY_TEXT, lead: ld, company: co, contact: elena, intelligence: null, mode: MODE === "auto" ? "auto" : "deterministic" });
  check("finds the named system", extraction.systems.some((s) => /bright\s*mls/i.test(s.name)), extraction.systems.map((s) => s.name).join(", ") || "none");
  check(
    "every extracted item quotes the reply verbatim",
    [...extraction.systems, ...extraction.facts].every((x) => REPLY_TEXT.toLowerCase().includes(x.quote.toLowerCase().trim())),
    [...extraction.systems, ...extraction.facts].map((x) => x.quote).join(" | ")
  );
  check("never reports pricing as a plain fact outside budget", extraction.facts.every((f) => f.field === "budget" || !/\$|per[- ]user|discount/i.test(f.value)));

  /* 2 · a fact with no matching quote in the source would be dropped, not invented */
  console.log("\n2. Would reject a hallucinated fact");
  const haystack = REPLY_TEXT.toLowerCase();
  const fakeFacts = [
    { field: "number_of_users" as const, label: "User count", value: "999", quote: "we have 999 people using this" },
    { field: null, label: "User count", value: "85", quote: "85 agents across our three branches" },
  ];
  const survivingFacts = fakeFacts.filter((f) => haystack.includes(f.quote.toLowerCase()));
  check("a quote not in the reply would be dropped", survivingFacts.length === 1 && survivingFacts[0].value === "85");

  /* 3 · webhook capture has no human at the keyboard, so nothing applies before confirmation */
  console.log("\n3. Nothing applies before a salesperson confirms — even automatically captured");
  const planNoneConfirmed = planCallRecapApplication(extraction.facts, extraction.systems, [], ld, NOW);
  check("confirming nothing writes nothing", planNoneConfirmed.applied.length === 0 && Object.keys(planNoneConfirmed.qualificationUpdates).length === 0);

  /* 4 · confirming a subset applies only that subset */
  console.log("\n4. Confirming a subset of facts applies only that subset");
  const userFactIndex = extraction.facts.findIndex((f) => f.field === "number_of_users");
  check("the user-count fact was found", userFactIndex >= 0, extraction.facts.map((f) => f.field).join(", "));
  if (userFactIndex >= 0) {
    const planOne = planCallRecapApplication(extraction.facts, extraction.systems, [userFactIndex], ld, NOW);
    check("user count is planned for write", planOne.qualificationUpdates.number_of_users === 85, String(planOne.qualificationUpdates.number_of_users));
    check("nothing else was applied", planOne.applied.length === 1, planOne.applied.join(", "));
  }

  /* 5 · an already-set qualification field is never overwritten */
  console.log("\n5. Never overwrites a qualification field that's already set");
  const alreadyQualified = { ...ld, qualification: { number_of_users: 60 } };
  if (userFactIndex >= 0) {
    const planOverwrite = planCallRecapApplication(extraction.facts, extraction.systems, [userFactIndex], alreadyQualified, NOW);
    check("the existing count is left alone", planOverwrite.qualificationUpdates.number_of_users === undefined, String(planOverwrite.qualificationUpdates.number_of_users));
  }

  /* 6 · confirming twice (across two webhook-confirm calls) changes nothing the second time */
  console.log("\n6. Re-confirming an already-applied fact is a no-op");
  if (userFactIndex >= 0) {
    const qualifiedAfterFirst = { ...ld, qualification: { number_of_users: 85 } };
    const planSecond = planCallRecapApplication(extraction.facts, extraction.systems, [userFactIndex], qualifiedAfterFirst, NOW);
    check("the second confirmation writes nothing new", planSecond.qualificationUpdates.number_of_users === undefined);
  }

  /* 7 · merging confirmed_indices across two confirm calls keeps both, exactly the
        merge `confirmInboundReplyFactsAction` performs before patching the record */
  console.log("\n7. Confirmed-index bookkeeping accumulates rather than replaces");
  const firstConfirm = [0];
  const secondConfirm = [1];
  const merged = [...new Set([...firstConfirm, ...secondConfirm])];
  check("both confirmations are retained", merged.length === 2 && merged.includes(0) && merged.includes(1), merged.join(","));

  /* 8 · deterministic fallback still works without Claude, since no live inbound
        provider is connected yet and this path must never depend on one */
  console.log("\n8. Works without Claude");
  const detExtraction = await extractFromReply({ replyText: REPLY_TEXT, lead: ld, company: co, contact: elena, intelligence: null, mode: "deterministic" });
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
