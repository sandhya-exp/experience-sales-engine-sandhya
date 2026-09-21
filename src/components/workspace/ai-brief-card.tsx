import { formatActivityTime } from "@/lib/format";
import { AlertTriangle, Sparkles, ArrowRight, CheckCircle2, Circle, BookOpen, FileText, ShieldCheck, Wrench, Database, Search } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RegenerateButton } from "@/components/workspace/regenerate-button";
import type { AiDealBrief } from "@/lib/types";
import type { AiProcess, OpportunityIntelligence, SourceRef } from "@/lib/ai/intelligence";
import { DOWNSTREAM } from "@/lib/modules";
import { cn } from "@/lib/utils";
import { Hint, FIELD_HINTS } from "@/components/ui/hint";
import { getKnowledgeDoc } from "@/lib/ai/knowledge/index";

/**
 * AI Opportunity Intelligence — the full AI source of truth for one opportunity.
 *
 * Customer Need · Evidence · Relevant Product Context · Qualification Gaps ·
 * Recommended Next Action · Quote Context · Quote Ready Readiness, plus an
 * expandable "AI Process" panel showing what was retrieved, which tools ran,
 * how each stage ran and what the evaluator concluded. Process metadata only —
 * never chain-of-thought.
 */
export function AiBriefCard({ brief, leadId, canContract = true }: { brief: AiDealBrief | null; leadId: string; canContract?: boolean }) {
  const intel = hasIntelligence(brief) ? brief.intelligence : null;
  const process = intel?.process ?? null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-navy text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          AI Opportunity Intelligence
          {brief && <ModeBadge generatedBy={brief.generated_by} process={process} />}
        </CardTitle>
        <div className="flex items-center gap-2">
          {brief && <span className="hidden text-xs text-muted-foreground sm:inline">{formatActivityTime(brief.generated_at)}</span>}
          <RegenerateButton leadId={leadId} />
        </div>
      </CardHeader>

      {!intel ? (
        <CardContent className="py-8 text-center text-sm text-muted-foreground">Refresh to analyze this opportunity.</CardContent>
      ) : (
        <CardContent className="space-y-6 pt-0">
          <Section label="Customer need">
            <p className="text-[15px] font-medium leading-snug text-foreground">{intel.customer_need}</p>
            {intel.quote_implications.length > 0 && (
              <ul className="mt-2.5 space-y-1.5">
                {intel.quote_implications.map((line) => (
                  <li key={line} className="flex gap-2 text-[13px] leading-snug text-foreground">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-navy" />
                    {line}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {intel.chain && intel.chain.length > 0 && <ChainStrip chain={intel.chain} />}

          {intel.evidence && intel.evidence.length > 0 && (
            <Section label="Evidence · sources used">
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {intel.evidence.map((e, i) => (
                  <li key={`${e.source}-${i}`} className="flex items-start gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-[13px] leading-snug">
                    <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0">
                      <span className="text-foreground">{e.claim}</span>
                      <span className="mt-0.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{sourceLabel(e.source)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {intel.product_context && (intel.product_context.capabilities.length > 0 || intel.product_context.implementation_considerations.length > 0) && (
            <Section label="Relevant product context">
              <div className="grid gap-3 lg:grid-cols-2">
                {intel.product_context.capabilities.length > 0 && (
                  <div className="space-y-2">
                    {intel.product_context.capabilities.map((c) => (
                      <div key={c.kb_id} className="rounded-lg border border-border px-3 py-2.5">
                        <p className="flex items-center gap-1.5 text-[13px] font-semibold text-foreground">
                          <BookOpen className="h-3.5 w-3.5 text-navy" /> {c.title}
                        </p>
                        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{c.why}</p>
                      </div>
                    ))}
                  </div>
                )}
                {intel.product_context.implementation_considerations.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Implementation considerations</p>
                    <ul className="space-y-1.5">
                      {intel.product_context.implementation_considerations.map((c, i) => (
                        <li key={i} className="flex gap-2 text-[13px] leading-snug text-foreground">
                          <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span>
                            {c.text}
                            {c.kb_id && <span className="ml-1 text-[11px] text-muted-foreground">· {kbTitle(intel, c.kb_id)}</span>}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">From the Sales Knowledge Base only. Pricing, packages and configuration are decided in {DOWNSTREAM.partner}.</p>
            </Section>
          )}

          <Section label="Qualification gaps">
            {intel.gaps.missing.length === 0 ? (
              <p className="flex items-center gap-1.5 text-[13px] text-success">
                <CheckCircle2 className="h-3.5 w-3.5" /> Nothing missing that affects the quote.
              </p>
            ) : (
              <ul className="grid gap-1.5 sm:grid-cols-2">
                {intel.gaps.missing.map((m) => (
                  <li key={m.label} className="flex items-start gap-1.5 text-[13px]">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                    <span className="min-w-0">
                      <span className="font-medium text-foreground">{m.label}</span>
                      <span className="block text-xs text-muted-foreground">{m.impact}</span>
                      {m.question && (
                        <span className="mt-0.5 block text-xs text-navy">
                          <span className="font-medium">Ask:</span> “{m.question}”
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {intel.contradictions && intel.contradictions.length > 0 && (
            <div className="rounded-xl border border-warning/40 bg-warning/5 p-4">
              <p className="section-label text-warning">AI check · potential conflict</p>
              <ul className="mt-2 space-y-3">
                {intel.contradictions.map((c, i) => (
                  <li key={i} className="grid gap-2 text-[13px] sm:grid-cols-[1fr_1fr_1.4fr]">
                    <div className="rounded-md border border-border bg-card px-2.5 py-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{sourceLabel(c.a.source)} says</p>
                      <p className="font-medium text-foreground">{c.a.value}</p>
                    </div>
                    <div className="rounded-md border border-border bg-card px-2.5 py-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{sourceLabel(c.b.source)} says</p>
                      <p className="font-medium text-foreground">{c.b.value}</p>
                    </div>
                    <div className="flex items-start gap-1.5 px-1 py-1">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                      <p className="leading-snug text-foreground">
                        <span className="font-medium">{c.topic}.</span> {c.action}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="rounded-xl border border-navy/15 bg-[#eef2fb] p-4">
            <p className="section-label text-navy">Recommended next action</p>
            <p className="mt-1 flex items-start gap-2 text-[15px] font-semibold leading-snug text-foreground">
              <ArrowRight className="mt-1 h-4 w-4 shrink-0 text-navy" /> {intel.next_action.action}
            </p>
            <p className="mt-1 pl-6 text-[13px] leading-snug text-muted-foreground">{intel.next_action.reason}</p>
          </div>

          <Section label="Quote context">
            <QuoteContextGrid context={intel.quote_context} />
            {intel.product_context && intel.product_context.quote_context_requirements.length > 0 && (
              <ul className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
                {intel.product_context.quote_context_requirements.map((r, i) => (
                  <li key={i} className="flex items-center gap-1.5 text-[12px]">
                    {r.status === "captured" ? <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-warning" />}
                    <span className={r.status === "captured" ? "text-foreground" : "text-muted-foreground"}>{r.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {intel.readiness && <ReadinessPanel readiness={intel.readiness} canContract={canContract} />}

          {process && <ProcessPanel process={process} evaluator={intel.readiness?.evaluator} />}
        </CardContent>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------------- chain */

/** The one-look chain a judge can follow: said → retrieved → identified → gap → readiness → next action. */
function ChainStrip({ chain }: { chain: NonNullable<OpportunityIntelligence["chain"]> }) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3">
      <p className="section-label mb-2">How the AI got here</p>
      <ol className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
        {chain.map((step, i) => (
          <li key={step.key} className="relative flex min-w-0 flex-col rounded-lg border border-border bg-card px-2.5 py-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-navy/10 text-[10px] text-navy">{i + 1}</span>
              {step.label}
            </p>
            <p className={cn("mt-1 text-[12.5px] leading-snug", step.tone === "warn" ? "text-foreground" : step.tone === "ok" ? "text-success" : "text-foreground")}>
              {step.tone === "warn" && <AlertTriangle className="mr-1 inline h-3 w-3 text-warning" />}
              {step.tone === "ok" && <CheckCircle2 className="mr-1 inline h-3 w-3" />}
              {step.text}
            </p>
            {step.sources.length > 0 && (
              <p className="mt-auto pt-1.5 text-[10.5px] text-muted-foreground">
                {step.sources
                  .slice(0, 3)
                  .map((s) => sourceLabel(s).replace("Knowledge base · ", "KB · "))
                  .join(" · ")}
                {step.sources.length > 3 && ` +${step.sources.length - 3}`}
              </p>
            )}
            {i < chain.length - 1 && <ArrowRight className="absolute -right-2.5 top-1/2 hidden h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground xl:block" />}
          </li>
        ))}
      </ol>
    </div>
  );
}

/* --------------------------------------------------------------- readiness */

function ReadinessPanel({ readiness, canContract }: { readiness: NonNullable<OpportunityIntelligence["readiness"]>; canContract: boolean }) {
  return (
    <div className={cn("rounded-xl border p-4", readiness.ready ? "border-success/30 bg-success/5" : "border-border bg-muted/40")}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="section-label">{DOWNSTREAM.readinessLabel}</p>
          <p className={cn("mt-1 flex items-center gap-2 text-[15px] font-semibold", readiness.ready ? "text-success" : "text-foreground")}>
            {readiness.ready ? <CheckCircle2 className="h-4 w-4" /> : <Circle className="h-4 w-4 text-warning" />}
            {readiness.ready ? `Ready to ${DOWNSTREAM.continueLabel.toLowerCase()}` : "Not ready yet"}
          </p>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{readiness.verdict}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-semibold tabular-nums text-foreground">
            {readiness.checks_passed}
            <span className="text-sm text-muted-foreground">/{readiness.checks_total}</span>
          </p>
          <p className="text-[11px] text-muted-foreground">qualification checks</p>
        </div>
      </div>
      {readiness.checks && readiness.checks.length > 0 && (
        <ul className="mt-3 grid gap-x-4 gap-y-1 sm:grid-cols-2">
          {readiness.checks.map((c) => (
            <li key={c.label} className="flex items-start gap-1.5 text-[13px]" title={c.hint}>
              {c.ok ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />}
              <span className={c.ok ? "text-foreground" : "font-medium text-foreground"}>{c.label}</span>
            </li>
          ))}
        </ul>
      )}
      {/* The footnote has to match the role: pointing a Sales User at a button
          they do not have would be the UI contradicting the permission. */}
      <p className="mt-2 text-[11px] text-muted-foreground">
        {canContract ? (
          <>
            The handoff is never automatic — it happens when you press <span className="font-medium text-foreground">{DOWNSTREAM.continueLabel}</span> in the header.
          </>
        ) : (
          <>The handoff is never automatic — an admin performs it once qualification is complete.</>
        )}
      </p>
    </div>
  );
}

/* ----------------------------------------------------------------- process */

const STAGE_ICON: Record<AiProcess["stages"][number]["key"], React.ComponentType<{ className?: string }>> = {
  retrieve: Search,
  analyst: Sparkles,
  solution_context: BookOpen,
  evaluator: ShieldCheck,
};

function ProcessPanel({ process, evaluator }: { process: AiProcess; evaluator?: NonNullable<OpportunityIntelligence["readiness"]>["evaluator"] }) {
  const flagged = process.stages.find((s) => s.key === "evaluator");
  return (
    <details className="group rounded-xl border border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-[13px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-navy" /> AI process &amp; evidence
          <span className="text-[12px] font-normal text-muted-foreground">
            · {process.tool_calls.length} tool calls · {process.retrieved.length} sources retrieved · {process.stages.filter((s) => s.key !== "retrieve").length} stages · {(process.total_ms / 1000).toFixed(1)}s
          </span>
        </span>
        <span className="text-[12px] text-muted-foreground group-open:hidden">Show</span>
        <span className="hidden text-[12px] text-muted-foreground group-open:inline">Hide</span>
      </summary>
      <div className="space-y-5 border-t border-border px-4 py-4">
        {/* Stages */}
        <ol className="space-y-2">
          {process.stages.map((s, i) => {
            const Icon = STAGE_ICON[s.key];
            return (
              <li key={s.key} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-navy/10 text-navy">
                  <Icon className="h-3.5 w-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-[13px] font-medium text-foreground">
                    <span className="text-muted-foreground">{i + 1}.</span> {s.label}
                    <StageModeBadge mode={s.mode} />
                    <span className="text-[11px] font-normal text-muted-foreground">{s.duration_ms} ms</span>
                  </p>
                  <p className="text-[12px] leading-snug text-muted-foreground">{s.summary}</p>
                  {s.note && <p className="text-[11px] italic text-muted-foreground">{s.note}</p>}
                </div>
              </li>
            );
          })}
        </ol>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* Tool calls */}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Database className="h-3 w-3" /> Tool calls (read-only)
            </p>
            <ul className="divide-y divide-border rounded-lg border border-border text-[12px]">
              {process.tool_calls.map((t, i) => (
                <li key={i} className="px-2.5 py-1.5">
                  <p className="flex items-baseline gap-1.5">
                    <code className="shrink-0 rounded bg-muted px-1 py-0.5 font-mono text-[11px] text-foreground">{t.tool}</code>
                    <span className="min-w-0 truncate text-muted-foreground" title={t.input}>
                      {t.input}
                    </span>
                  </p>
                  <p className="mt-0.5 break-words pl-0.5 text-foreground" title={t.output}>
                    → {t.output}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {/* Retrieved knowledge */}
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <BookOpen className="h-3 w-3" /> Retrieved from the Sales Knowledge Base
            </p>
            {process.retrieved.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">No documents matched.</p>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border text-[12px]">
                {process.retrieved.map((r) => (
                  <li key={r.id} className="px-2.5 py-1.5">
                    <p className="flex items-center justify-between gap-2">
                      <span className="font-medium text-foreground">{r.title}</span>
                      <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{r.category.replace("_", " ")}</span>
                    </p>
                    <p className="text-[11px] text-muted-foreground">matched: {r.matched_terms.slice(0, 6).join(", ")}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Sources + evaluator conclusions */}
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Record sources available to the AI</p>
            <div className="flex flex-wrap gap-1">
              {process.sources.map((s) => (
                <span key={s} className="rounded-md border border-border bg-card px-1.5 py-0.5 text-[11px] text-foreground">
                  {sourceLabel(s)}
                </span>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Evaluator conclusion</p>
            <p className="text-[12px] text-foreground">{flagged?.summary}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Mode: {process.mode === "claude" ? `Claude (${process.model})` : "deterministic"}
              {process.tokens.input + process.tokens.output > 0 && ` · ${process.tokens.input + process.tokens.output} tokens`} · {new Date(process.generated_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </p>
          </div>
        </div>
        <EvaluatorFlags evaluator={evaluator} />
      </div>
    </details>
  );
}

function EvaluatorFlags({ evaluator }: { evaluator?: NonNullable<OpportunityIntelligence["readiness"]>["evaluator"] }) {
  if (!evaluator || (evaluator.flagged.length === 0 && evaluator.contradictions.length === 0)) {
    return <p className="text-[12px] text-success">✓ No unsupported claims or contradictions — every statement above traces to the record or a retrieved document.</p>;
  }
  return (
    <div className="space-y-2">
      {evaluator.contradictions.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-destructive">Contradictions with the record</p>
          <ul className="space-y-1 text-[12px] text-foreground">
            {evaluator.contradictions.map((c, i) => (
              <li key={i}>· {c}</li>
            ))}
          </ul>
        </div>
      )}
      {evaluator.flagged.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-warning">Removed by the evaluator ({evaluator.flagged.length})</p>
          <ul className="space-y-1 text-[12px]">
            {evaluator.flagged.map((f, i) => (
              <li key={i} className="rounded-md border border-warning/30 bg-warning/5 px-2 py-1">
                <span className="line-through decoration-warning/60 text-muted-foreground">{f.text}</span>
                <span className="block text-[11px] text-foreground">{f.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ badges */

function ModeBadge({ generatedBy, process }: { generatedBy: string; process: AiProcess | null }) {
  const claude = generatedBy.startsWith("claude:") || generatedBy.startsWith("llm:") || process?.mode === "claude";
  const model = process?.model ?? generatedBy.split(":")[1] ?? null;
  return (
    <Badge variant={claude ? "navy" : "outline"} className="ml-1 font-medium" title={claude ? `Generated with Claude${model ? ` (${model})` : ""}, validated deterministically` : "Generated by the deterministic engine — Claude not configured or unavailable"}>
      {claude ? `Claude${model ? ` · ${shortModel(model)}` : ""}` : "Deterministic"}
    </Badge>
  );
}

function StageModeBadge({ mode }: { mode: AiProcess["stages"][number]["mode"] }) {
  const styles = mode === "claude" ? "bg-navy/10 text-navy" : mode === "deterministic" ? "bg-muted text-muted-foreground" : "bg-warning/10 text-warning";
  return <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", styles)}>{mode}</span>;
}

function shortModel(m: string) {
  return m.replace(/^claude-/, "").replace(/-\d{8}$/, "");
}

/* ----------------------------------------------------------------- helpers */

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="section-label mb-1.5">{label}</p>
      {children}
    </div>
  );
}

export function sourceLabel(ref: SourceRef) {
  if (ref === "inquiry") return "Customer inquiry";
  if (ref === "qualification") return "Qualification";
  if (ref.startsWith("contact:")) return `Contact · ${ref.slice(8)}`;
  if (ref.startsWith("activity:")) return `Activity #${ref.slice(9)}`;
  if (ref.startsWith("kb:")) return `Knowledge base · ${getKnowledgeDoc(ref.slice(3))?.title.replace(/\s*\(.*?\)\s*/g, "") ?? ref.slice(3)}`;
  return ref;
}

function kbTitle(intel: OpportunityIntelligence, id: string) {
  return intel.process?.retrieved.find((r) => r.id === id)?.title ?? intel.product_context?.capabilities.find((c) => c.kb_id === id)?.title ?? id;
}

function QuoteContextGrid({ context, compact }: { context: OpportunityIntelligence["quote_context"]; compact?: boolean }) {
  const rows: [string, string | null, string][] = [
    ["Customer", context.customer, "customer"],
    ["Industry", context.industry, "industry"],
    ["Users", context.users ? String(context.users) : null, "users"],
    ["Primary need", context.primary_need, "primary_need"],
    ["Deployment", context.deployment, "deployment"],
    ["Decision timeline", context.decision_timeline, "decision_timeline"],
    ["Decision maker", context.decision_maker, "decision_maker"],
    ["Budget", context.budget, "budget"],
    ["Current solution", context.current_solution, "current_solution"],
    ["Integrations", context.integrations.length ? context.integrations.join(", ") : null, "integrations"],
    ["Primary contact", context.primary_contact ? `${context.primary_contact.name}${context.primary_contact.email ? ` · ${context.primary_contact.email}` : ""}` : null, "primary_contact"],
  ];
  return (
    <div className="overflow-hidden rounded-lg border border-border">
      <dl className={cn("grid text-[13px]", compact ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-2 lg:grid-cols-3")}>
        {rows.map(([label, value, key]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 border-b border-border px-3 py-2 odd:bg-muted/40 sm:border-r [&:nth-last-child(-n+2)]:border-b-0">
            <dt className="flex shrink-0 items-center text-muted-foreground">
              {label}
              {FIELD_HINTS[key] && <Hint text={FIELD_HINTS[key]} />}
            </dt>
            <dd className={cn("truncate text-right font-medium", value ? "text-foreground" : "text-warning")}>{value ?? "Not confirmed"}</dd>
          </div>
        ))}
      </dl>
      {context.key_requirements.length > 0 && (
        <div className="border-t border-border bg-card px-3 py-2">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Key requirements</p>
          <ul className="mt-1 space-y-0.5">
            {context.key_requirements.map((r) => (
              <li key={r} className="text-[13px] text-foreground">
                · {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function hasIntelligence(brief: AiDealBrief | null): brief is AiDealBrief & { intelligence: OpportunityIntelligence } {
  return Boolean(brief && brief.intelligence && "quote_context" in brief.intelligence);
}
