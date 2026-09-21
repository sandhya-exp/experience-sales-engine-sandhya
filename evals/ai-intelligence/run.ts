/**
 * AI Opportunity Intelligence — evaluation runner.
 *
 *   npm run eval:ai                 # deterministic mode (no API key needed)
 *   npm run eval:ai -- --claude     # also run every case through Claude (needs ANTHROPIC_API_KEY)
 *   npm run eval:ai -- --verbose    # print each brief
 *
 * For every case it checks the things a judge would ask about:
 *   - no invented figures: every number in the brief appears in the record or a retrieved document
 *   - no commercial content: no prices, packages, tiers or discounts
 *   - grounded citations: every evidence source exists on the record, every KB citation was retrieved
 *   - correct gaps: the expected missing qualification is reported, and captured fields are not
 *   - correct readiness for Guided Selling
 *   - the expected knowledge documents were retrieved
 * Exits non-zero on any failure.
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config();

import { generateDealBrief, memorySource, type GeneratedBrief } from "@/lib/ai/dealBrief";
import { claudeAvailable } from "@/lib/ai/claude";
import { buildCases, type EvalCase } from "./cases";

const args = new Set(process.argv.slice(2));
const verbose = args.has("--verbose");
const wantClaude = args.has("--claude");

const COMMERCIAL = /\b(price|pricing|priced|per[- ](?:user|seat)|packages?|tiers?|discounts?|quote amount|licen[cs]e fees?|list price)\b/i;

interface Failure {
  check: string;
  detail: string;
}

function textOf(b: GeneratedBrief): string[] {
  const i = b.intelligence;
  return [
    i.customer_need,
    ...i.quote_implications,
    ...(i.evidence ?? []).map((e) => e.claim),
    ...(i.product_context?.capabilities ?? []).map((c) => c.why),
    ...(i.product_context?.implementation_considerations ?? []).map((c) => c.text),
    ...(i.product_context?.quote_context_requirements ?? []).map((c) => c.text),
    ...(i.contradictions ?? []).flatMap((x) => [x.a.value, x.b.value, x.action]),
    ...i.gaps.missing.map((m) => m.question ?? ""),
    ...(i.chain ?? []).filter((s) => s.key !== "customer_says" && s.key !== "next_action" && s.key !== "readiness").map((s) => s.text),
    i.next_action.action,
    i.next_action.reason,
    i.readiness?.verdict ?? "",
  ].filter(Boolean);
}

function numbersIn(s: string) {
  return (s.match(/\d[\d,.]*/g) ?? []).map((n) => n.replace(/[,.]$/, "").replace(/,/g, ""));
}

function check(c: EvalCase, b: GeneratedBrief): Failure[] {
  const f: Failure[] = [];
  const i = b.intelligence;
  const lines = textOf(b);
  const all = lines.join("\n");
  const lower = all.toLowerCase();

  // Record + retrieved KB text = the only places a figure may come from.
  const recordText = JSON.stringify(c.ctx).toLowerCase();
  const kbText = (i.process?.retrieved ?? []).map((r) => r.title).join(" ").toLowerCase();
  const allowedNumbers = new Set([...numbersIn(recordText), ...numbersIn(kbText), ...numbersIn(String(i.readiness?.checks_passed)), ...numbersIn(String(i.readiness?.checks_total))]);
  // The verdict legitimately counts things ("3 qualification items"), so allow small counts there.
  const countable = new Set(["0", "1", "2", "3", "4", "5", "6", "7", "8"]);
  // next_action text is a deterministic template that may format a booked follow-up's local time, so it is exempt from the figure check.
  const templated = new Set([i.next_action.action, i.next_action.reason]);
  for (const line of lines) {
    for (const n of templated.has(line) ? [] : numbersIn(line)) {
      if (!allowedNumbers.has(n) && !(countable.has(n) && line === i.readiness?.verdict)) {
        f.push({ check: "no-invented-figures", detail: `"${n}" in: ${line}` });
      }
    }
    if (COMMERCIAL.test(line)) f.push({ check: "no-commercial-content", detail: line });
  }

  // Citations
  const sources = new Set(i.process?.sources ?? []);
  for (const e of i.evidence ?? []) if (!sources.has(e.source)) f.push({ check: "evidence-source-exists", detail: `${e.source} ← ${e.claim}` });
  const retrievedIds = new Set((i.process?.retrieved ?? []).map((r) => r.id));
  for (const cap of i.product_context?.capabilities ?? []) if (!retrievedIds.has(cap.kb_id)) f.push({ check: "kb-citation-retrieved", detail: cap.kb_id });
  for (const cons of i.product_context?.implementation_considerations ?? []) if (cons.kb_id && !retrievedIds.has(cons.kb_id)) f.push({ check: "kb-citation-retrieved", detail: cons.kb_id });

  // Gaps
  const missing = new Set(i.gaps.missing.map((m) => m.label));
  for (const m of c.expect.missing) if (!missing.has(m)) f.push({ check: "missing-detected", detail: `expected "${m}" in gaps, got [${[...missing].join(", ")}]` });
  for (const m of c.expect.notMissing ?? []) if (missing.has(m)) f.push({ check: "captured-not-flagged", detail: `"${m}" reported missing although captured` });

  // Readiness
  if (!i.readiness) f.push({ check: "readiness-present", detail: "no readiness block" });
  else if (i.readiness.ready !== c.expect.ready) f.push({ check: "readiness", detail: `expected ready=${c.expect.ready}, got ${i.readiness.ready} (${i.readiness.verdict})` });

  // Retrieval
  for (const id of c.expect.retrieved) if (!retrievedIds.has(id)) f.push({ check: "retrieval", detail: `expected ${id}, retrieved [${[...retrievedIds].join(", ")}]` });

  // Extraction
  if (c.expect.integrations) {
    const got = [...i.quote_context.integrations].sort().join(",");
    const want = [...c.expect.integrations].sort().join(",");
    if (got !== want) f.push({ check: "integrations", detail: `expected [${want}], got [${got}]` });
  }
  if (c.expect.deployment !== undefined && i.quote_context.deployment !== c.expect.deployment) f.push({ check: "deployment", detail: `expected "${c.expect.deployment}", got "${i.quote_context.deployment}"` });

  // Contradictions + dynamic gaps
  if (c.expect.contradictions) {
    const got = (i.contradictions ?? []).map((x) => x.topic);
    for (const t of c.expect.contradictions) if (!got.includes(t)) f.push({ check: "contradiction-detected", detail: `expected "${t}", got [${got.join(", ")}]` });
    if (c.expect.contradictions.length === 0 && got.length) f.push({ check: "no-false-contradiction", detail: got.join(", ") });
    for (const x of i.contradictions ?? []) for (const src of [x.a.source, x.b.source]) if (!sources.has(src)) f.push({ check: "contradiction-source-exists", detail: src });
  }
  for (const q of c.expect.questions ?? []) {
    const gap = i.gaps.missing.find((m) => m.label === q);
    if (!gap) f.push({ check: "dynamic-gap", detail: `expected gap "${q}"` });
    else if (!gap.question) f.push({ check: "gap-has-question", detail: q });
  }
  for (const m of i.gaps.missing) if (m.field && !m.question) f.push({ check: "gap-has-question", detail: m.label });
  // Every readiness check must be present and consistent with the verdict.
  if (i.readiness && i.readiness.ready && i.readiness.checks.some((x) => !x.ok)) f.push({ check: "readiness-consistent", detail: "ready=true with failing checks" });

  if (c.expect.nextActionIncludes && !i.next_action.action.includes(c.expect.nextActionIncludes)) f.push({ check: "next-action", detail: `expected "${c.expect.nextActionIncludes}" in "${i.next_action.action}"` });
  // Chain: six steps, every KB reference retrieved, gap step as expected
  if (!i.chain || i.chain.length !== 6) f.push({ check: "chain-present", detail: `expected 6 chain steps, got ${i.chain?.length ?? 0}` });
  for (const step of i.chain ?? []) for (const src of step.sources) if (src.startsWith("kb:") && !retrievedIds.has(src.slice(3))) f.push({ check: "chain-kb-retrieved", detail: src });
  if (c.expect.chainGapIncludes && !i.chain?.find((s) => s.key === "gap")?.text.includes(c.expect.chainGapIncludes)) f.push({ check: "chain-gap", detail: i.chain?.find((s) => s.key === "gap")?.text ?? "none" });

  // Text expectations
  for (const m of c.expect.mentions ?? []) if (!lower.includes(m.toLowerCase())) f.push({ check: "mentions", detail: `"${m}" not found` });
  for (const m of c.expect.forbids ?? []) if (lower.includes(m.toLowerCase())) f.push({ check: "forbids", detail: `"${m}" found` });

  // Shape
  if (!i.evidence?.length) f.push({ check: "evidence-present", detail: "no evidence items" });
  if (!i.process) f.push({ check: "process-present", detail: "no process metadata" });
  else {
    const tools = i.process.tool_calls.map((t) => t.tool);
    for (const t of ["get_opportunity", "get_contacts", "get_activities", "get_qualification", "search_knowledge"]) if (!tools.includes(t as never)) f.push({ check: "tools-ran", detail: `${t} not called` });
    if (i.process.stages.length !== 4) f.push({ check: "stages", detail: `expected 4 stages, got ${i.process.stages.length}` });
  }
  return f;
}

async function runMode(mode: "deterministic" | "auto", cases: EvalCase[]) {
  console.log(`\n=== ${mode === "auto" ? "Claude + deterministic guardrail" : "Deterministic fallback"} ===`);
  let failures = 0;
  for (const c of cases) {
    const started = Date.now();
    const brief = await generateDealBrief(c.ctx, memorySource(c.ctx), { mode });
    const f = check(c, brief);
    const p = brief.intelligence.process!;
    const mark = f.length ? "✗" : "✓";
    console.log(`${mark} ${c.name}  [${p.mode}${p.model ? ` · ${p.model}` : ""} · ${Date.now() - started} ms · ${p.retrieved.length} docs · ${brief.intelligence.evidence?.length ?? 0} evidence · ${brief.intelligence.readiness?.evaluator.flagged.length ?? 0} removed]`);
    if (mode === "auto" && p.mode !== "claude") console.log(`    ! ran deterministically: ${p.stages.find((s) => s.key === "analyst")?.note ?? "unknown"}`);
    for (const x of f) console.log(`    - ${x.check}: ${x.detail}`);
    if (verbose) {
      const i = brief.intelligence;
      console.log(`    need: ${i.customer_need}`);
      for (const e of i.evidence ?? []) console.log(`    evidence [${e.source}] ${e.claim}`);
      for (const cap of i.product_context?.capabilities ?? []) console.log(`    product  [${cap.kb_id}] ${cap.why}`);
      console.log(`    next: ${i.next_action.action}`);
      console.log(`    readiness: ${i.readiness?.ready} — ${i.readiness?.verdict}`);
      for (const fl of i.readiness?.evaluator.flagged ?? []) console.log(`    removed: "${fl.text}" — ${fl.reason}`);
    }
    failures += f.length;
  }
  return failures;
}

async function main() {
  const cases = buildCases();
  let failures = await runMode("deterministic", cases);
  if (wantClaude) {
    if (!claudeAvailable()) console.log("\n(--claude requested but ANTHROPIC_API_KEY is not set — skipping)");
    else failures += await runMode("auto", cases);
  }
  console.log(`\n${failures === 0 ? "All checks passed" : `${failures} check(s) failed`} across ${cases.length} opportunities.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
