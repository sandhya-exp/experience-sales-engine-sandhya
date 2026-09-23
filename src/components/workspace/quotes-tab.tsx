import { AlertTriangle, ArrowRight, CheckCircle2, Circle, FileText, GitCompare, MessageSquare, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { QuoteFormDialog } from "@/components/workspace/quote-form-dialog";
import { QuoteActions } from "@/components/workspace/quote-actions";
import { activeQuote, diffQuotes, effectiveStatus, formatMoney, isEmptyDiff, previousVersion, QUOTE_FLOW, QUOTE_STATUS_LABEL, type QuoteRow, type QuoteStatus } from "@/lib/repo/quotes";
import { chainComplete, discountRules, pendingStep } from "@/lib/quotes/rules";
import { parseBudget } from "@/lib/quotes/review";
import { cn } from "@/lib/utils";
import type { Company, Lead } from "@/lib/types";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";

/**
 * Quotes on an opportunity — the versions as one table, the active one open
 * for review with its check and its actions. Compact on purpose: a rep should
 * see "v2, $14,400, sent Tuesday, waiting on Dana" without scrolling.
 */
export function QuotesTab({
  leadId,
  lead,
  company,
  quotes,
  isAdmin,
  intelligence,
}: {
  leadId: string;
  lead: Lead;
  company: Company;
  quotes: QuoteRow[];
  isAdmin: boolean;
  /** Passed through to the line editor so it can flag an uncovered requirement live, before save. */
  intelligence: OpportunityIntelligence | null;
}) {
  const active = activeQuote(quotes);
  const status = active ? effectiveStatus(active.meta) : null;
  // The editor runs in the browser, so the thresholds and the customer's own
  // stated figure are handed to it rather than read there.
  const rules = discountRules();
  const target = parseBudget(lead.qualification?.budget ?? null)?.amount ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="flex items-center gap-2">
            Quotes
            {active && (
              <span className="text-[12px] font-normal text-muted-foreground">
                · v{active.meta.version} active · {formatMoney(active.meta.total)}
              </span>
            )}
          </CardTitle>
          <div className="flex gap-2">
            {active?.meta.status === "draft" && (
              <QuoteFormDialog leadId={leadId} existing={active.meta} activityId={active.activityId} trigger="edit" rules={rules} targetAmount={target} companyName={company.name} lead={lead} intelligence={intelligence} />
            )}
            <QuoteFormDialog leadId={leadId} existing={active?.meta ?? null} rules={rules} targetAmount={target} companyName={company.name} lead={lead} intelligence={intelligence} />
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {quotes.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              No quote yet. {lead.status === "qualified" || lead.status === "quoted" ? "Qualification is complete — create the first version." : "Most teams quote once qualification is complete."}
            </p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border">
              <table className="w-full text-[13px]">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold">Version</th>
                    <th className="px-3 py-2 text-left font-semibold">Status</th>
                    <th className="px-3 py-2 text-right font-semibold">Amount</th>
                    <th className="px-3 py-2 text-right font-semibold">Discount</th>
                    <th className="px-3 py-2 text-left font-semibold">Created</th>
                    <th className="px-3 py-2 text-left font-semibold">Valid until</th>
                    <th className="px-3 py-2 text-left font-semibold">Check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {quotes.map((q) => {
                    const s = effectiveStatus(q.meta);
                    const isActive = active?.activityId === q.activityId;
                    return (
                      <tr key={q.activityId} className={cn(isActive ? "bg-accent/40" : q.meta.superseded ? "text-muted-foreground" : "")}>
                        <td className="px-3 py-2 font-medium">
                          v{q.meta.version} {isActive && <Badge variant="navy" className="ml-1 text-[10px]">Active</Badge>}
                          {q.meta.superseded && <span className="ml-1 text-[11px]">superseded</span>}
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={s} />
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatMoney(q.meta.total)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{q.meta.discount_pct}%</td>
                        <td className="px-3 py-2">{new Date(q.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</td>
                        <td className="px-3 py-2">{q.meta.valid_until}</td>
                        <td className="px-3 py-2">
                          {q.meta.review.ok ? (
                            <span className="inline-flex items-center gap-1 text-success">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Clear
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <AlertTriangle className="h-3.5 w-3.5" /> {q.meta.review.issues.length} issue{q.meta.review.issues.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {active && status && <QuoteReview quote={active} status={status} company={company} isAdmin={isAdmin} previous={previousVersion(quotes, active.meta.version)} />}
      {quotes.length > 0 && <QuoteConversation quotes={quotes} />}
    </div>
  );
}

/* ------------------------------------------------------------------ review */

function QuoteReview({ quote, status, company, isAdmin, previous }: { quote: QuoteRow; status: QuoteStatus; company: Company; isAdmin: boolean; previous: QuoteRow | null }) {
  const m = quote.meta;
  const diff = previous ? diffQuotes(previous.meta, m) : null;
  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-navy" /> Quote v{m.version} · review
          <StatusBadge status={status} />
        </CardTitle>
        <QuoteActions activityId={quote.activityId} status={status} needsApproval={m.review.needs_approval} isAdmin={isAdmin} version={m.version} />
      </CardHeader>
      <CardContent className="space-y-4 pt-0">
        {/* Where this quote is in its life, and the numbers that define it —
            the header every CPQ opens with, so nobody has to read the table to
            learn what the deal is worth. */}
        <QuoteFlow status={status} />
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 rounded-lg border border-border bg-muted/20 px-4 py-3 sm:grid-cols-4">
          <Fact label="Customer" value={company.name} />
          <Fact label="Valid until" value={m.valid_until} />
          {m.term_months ? <Fact label="Term" value={`${m.term_months} months${m.end_date ? ` to ${m.end_date}` : ""}`} /> : null}
          <Fact label="Discount" value={`${m.discount_pct}%`} />
          {m.tax_total ? <Fact label="Tax" value={formatMoney(m.tax_total)} /> : null}
          <Fact label="Total" value={formatMoney(m.total)} strong />
        </dl>

        {/* An approver sent it back. This is the first thing the owner needs to
            read, so it sits above the chain rather than in the timeline. */}
        {m.changes_requested && (
          <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/5 px-3 py-2.5 text-[13px]">
            <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
            <p className="text-foreground">
              <span className="font-medium">{m.changes_requested.by} asked for changes: </span>
              {m.changes_requested.note}{" "}
              <span className="text-muted-foreground">Edit the draft and it goes back for approval.</span>
            </p>
          </div>
        )}

        {/* The approval chain, when the rules produced one. */}
        {m.approvals && m.approvals.length > 0 && <ApprovalChain steps={m.approvals} />}

        {/* What this quote does not price. A partial quote is fine; a silent one isn't. */}
        {m.not_covered && m.not_covered.length > 0 && (
          <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-[13px]">
            <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <p className="text-foreground">
              <span className="font-medium">Partial quote — not priced here: </span>
              {m.not_covered.join(", ")}.{" "}
              <span className="text-muted-foreground">The customer asked about these; add a line or say why they are out of scope.</span>
            </p>
          </div>
        )}

        {/* What moved since the version the customer already saw. */}
        {diff && previous && !isEmptyDiff(diff) && <WhatChanged from={previous.meta.version} to={m.version} diff={diff} />}

        {/* The check: it decides whether the buttons above do anything. */}
        <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px]", m.review.ok ? "border-success/30 bg-success/5" : "border-warning/40 bg-warning/5")}>
          <ShieldCheck className={cn("mt-0.5 h-4 w-4 shrink-0", m.review.ok ? "text-success" : "text-warning")} />
          <div className="min-w-0">
            <p className="font-medium text-foreground">{m.review.ok ? "AI check: no pricing or qualification issues detected." : `AI check: ${m.review.issues.length} issue${m.review.issues.length === 1 ? "" : "s"}${m.review.needs_approval ? " — manager approval required before sending" : ""}.`}</p>
            {!m.review.ok && (
              <ul className="mt-1 space-y-0.5 text-[12.5px] text-foreground">
                {m.review.issues.map((i) => (
                  <li key={i}>· {i}</li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground">Deterministic check against the discount threshold, the customer&rsquo;s stated budget and the qualification record. It reads the record; it never sets a price.</p>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_260px]">
          <div className="overflow-hidden rounded-lg border border-border">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-semibold">Product / service</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Qty</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Price</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Discount</th>
                  <th className="px-3 py-1.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {m.line_items.map((it, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 text-foreground">{it.description}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{it.quantity}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(it.unit_price)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{it.discount_pct}%</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(it.quantity * it.unit_price * (1 - it.discount_pct / 100))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-muted/20 text-[13px]">
                <tr>
                  <td colSpan={4} className="px-3 py-1.5 text-right text-muted-foreground">Subtotal</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{formatMoney(m.subtotal)}</td>
                </tr>
                <tr>
                  <td colSpan={4} className="px-3 py-1.5 text-right text-muted-foreground">Discount ({m.discount_pct}%)</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">−{formatMoney(m.discount_total)}</td>
                </tr>
                <tr className="font-semibold">
                  <td colSpan={4} className="px-3 py-2 text-right">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatMoney(m.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <dl className="space-y-2 text-[13px]">
            <Row label="Customer" value={company.name} />
            <Row label="Terms" value={m.terms ?? "—"} />
            <Row label="Valid until" value={m.valid_until} />
            <Row
              label="Approval"
              value={
                !m.approvals || m.approvals.length === 0
                  ? "Not required"
                  : chainComplete(m.approvals)
                    ? "Chain complete"
                    : `Waiting on ${pendingStep(m.approvals)?.role === "admin" ? "an admin" : "a manager"}`
              }
            />
            <Row label="Created by" value={m.created_by} />
            {m.notes && <Row label="Notes" value={m.notes} />}
            <div className="pt-1">
              <dt className="section-label">History</dt>
              <dd className="mt-1 space-y-0.5 text-[12px] text-muted-foreground">
                {m.history.map((h, i) => (
                  <p key={i}>
                    {new Date(h.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {h.status}
                    {h.note ? ` (${h.note})` : ""} · {h.by}
                  </p>
                ))}
              </dd>
            </div>
          </dl>
        </div>
      </CardContent>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border pb-1.5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium text-foreground">{value}</dd>
    </div>
  );
}

export function StatusBadge({ status }: { status: QuoteStatus }) {
  const variant = status === "accepted" ? "success" : status === "sent" || status === "viewed" ? "navy" : status === "approved" ? "default" : status === "expired" || status === "recalled" ? "destructive" : "outline";
  return (
    <Badge variant={variant} className="font-medium">
      {QUOTE_STATUS_LABEL[status]}
    </Badge>
  );
}

/* ------------------------------------------------- flow, chain, difference */

/** Draft → Approved → Sent → Negotiating → Re-quoted → Accepted, as one line. */
function QuoteFlow({ status }: { status: QuoteStatus }) {
  const at = QUOTE_FLOW.indexOf(status);
  // A closed-off state (recalled, expired) is not on the forward path; say so
  // rather than pretending the quote is still somewhere on it.
  if (at < 0) {
    return (
      <p className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 text-warning" /> This version is {QUOTE_STATUS_LABEL[status].toLowerCase()} — it is no longer with the customer.
      </p>
    );
  }
  return (
    <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px]">
      {QUOTE_FLOW.map((step, i) => (
        <li key={step} className="flex items-center gap-1.5">
          <span
            className={cn(
              "rounded-md px-2 py-0.5 font-medium",
              i < at ? "bg-success/10 text-success" : i === at ? "bg-navy text-white" : "bg-muted text-muted-foreground"
            )}
          >
            {QUOTE_STATUS_LABEL[step]}
          </span>
          {i < QUOTE_FLOW.length - 1 && <ArrowRight className="h-3 w-3 text-muted-foreground/60" />}
        </li>
      ))}
    </ol>
  );
}

/**
 * The approval chain.
 *
 * Shown as steps rather than a single "needs approval" flag, because who has to
 * sign and why are the two things the person looking at it needs, and a rep
 * waiting on an approval deserves to know which one and for what reason.
 */
function ApprovalChain({ steps }: { steps: NonNullable<QuoteRow["meta"]["approvals"]> }) {
  const done = chainComplete(steps);
  return (
    <div className={cn("rounded-lg border px-3 py-2.5", done ? "border-success/30 bg-success/5" : "border-warning/40 bg-warning/5")}>
      <p className="flex items-center gap-1.5 text-[13px] font-medium text-foreground">
        <ShieldCheck className={cn("h-4 w-4", done ? "text-success" : "text-warning")} />
        {done ? "Approval chain complete — this quote can be sent." : `Approval chain · ${steps.filter((s) => s.state === "approved").length} of ${steps.length} given`}
      </p>
      <ol className="mt-1.5 space-y-1">
        {steps.map((s, i) => (
          <li key={i} className="flex items-start gap-2 text-[12.5px]">
            {s.state === "approved" ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> : <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />}
            <span className="min-w-0">
              <span className="font-medium text-foreground">{s.role === "admin" ? "Admin" : "Sales manager"}</span>
              <span className="text-muted-foreground"> — {s.reason}</span>
              {s.state === "approved" && s.by && (
                <span className="text-success"> Approved by {s.by}{s.at ? ` on ${new Date(s.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}.</span>
              )}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * What changed between this version and the one before it.
 *
 * The question about a re-quote is never "what is in it" — the customer has the
 * previous one in front of them — it is "what did you change". Every difference
 * is a before and an after, so it can be read aloud on a call.
 */
function WhatChanged({ from, to, diff }: { from: number; to: number; diff: ReturnType<typeof diffQuotes> }) {
  return (
    <details className="group rounded-lg border border-border">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-3 py-2.5 text-[13px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-2">
          <GitCompare className="h-4 w-4 text-navy" /> What changed from v{from} to v{to}
          <span className={cn("text-[12px] font-normal tabular-nums", diff.totalDelta === 0 ? "text-muted-foreground" : diff.totalDelta < 0 ? "text-success" : "text-warning")}>
            · {diff.totalDelta === 0 ? "same total" : `${diff.totalDelta > 0 ? "+" : "−"}${formatMoney(Math.abs(diff.totalDelta))}`}
          </span>
        </span>
        <span className="text-[12px] font-medium text-primary group-open:hidden">Show</span>
        <span className="hidden text-[12px] font-medium text-primary group-open:inline">Hide</span>
      </summary>
      <ul className="space-y-1 border-t border-border px-3 py-2.5 text-[12.5px]">
        {diff.added.map((i) => (
          <li key={`a-${i.description}`} className="text-success">+ Added {i.description} — {i.quantity} × {formatMoney(i.unit_price)}</li>
        ))}
        {diff.removed.map((i) => (
          <li key={`r-${i.description}`} className="text-destructive">− Removed {i.description}</li>
        ))}
        {diff.changed.map((c, i) => (
          <li key={`c-${i}`} className="text-foreground">
            <span className="font-medium">{c.description}</span> · {c.field} {c.from} → {c.to}
          </li>
        ))}
        {diff.validityChanged && (
          <li className="text-foreground">Valid until {diff.validityChanged.from} → {diff.validityChanged.to}</li>
        )}
        {diff.termsChanged && <li className="text-foreground">Terms reworded</li>}
        {diff.discountDelta !== 0 && (
          <li className="text-muted-foreground">Overall discount {diff.discountDelta > 0 ? "up" : "down"} {Math.abs(diff.discountDelta)} points</li>
        )}
      </ul>
    </details>
  );
}

function Fact({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="section-label truncate">{label}</dt>
      <dd className={cn("mt-0.5 truncate text-[13px] tabular-nums", strong ? "text-[15px] font-bold text-foreground" : "font-medium text-foreground")}>{value}</dd>
    </div>
  );
}

/**
 * The conversation about this quote, on the deal.
 *
 * Every version's history, merged into one thread in the order it happened —
 * created, approved, sent, viewed, re-quoted, accepted. It answers the question
 * a rep has when they pick a negotiation back up after a fortnight: what have
 * we already said to these people, and when. Nothing new is stored for it; it
 * is the history each quote already carries, read across versions.
 */
function QuoteConversation({ quotes }: { quotes: QuoteRow[] }) {
  const entries = quotes
    .flatMap((q) => q.meta.history.map((h) => ({ ...h, version: q.meta.version })))
    .sort((a, b) => a.at.localeCompare(b.at));
  if (entries.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <FileText className="h-4 w-4 text-navy" /> Quote conversation
          <span className="text-[12px] font-normal text-muted-foreground">· {entries.length} events across {quotes.length} version{quotes.length === 1 ? "" : "s"}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <ol className="space-y-1.5">
          {entries.map((e, i) => (
            <li key={i} className="flex flex-wrap items-baseline gap-x-2 text-[12.5px]">
              <span className="w-32 shrink-0 tabular-nums text-muted-foreground">
                {new Date(e.at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">v{e.version}</span>
              <span className="font-medium text-foreground">{describeEvent(e.status)}</span>
              <span className="text-muted-foreground">
                by {e.by}
                {e.note ? ` · ${e.note}` : ""}
              </span>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function describeEvent(status: string) {
  const map: Record<string, string> = {
    created: "Drafted",
    edited: "Edited",
    cloned: "Cloned into a new version",
    approved: "Approved",
    sent: "Sent to the customer",
    viewed: "Opened by the customer",
    negotiating: "Customer came back with changes",
    requoted: "Replaced by a new version",
    accepted: "Accepted by the customer",
    recalled: "Recalled",
    expired: "Expired",
  };
  return map[status] ?? status;
}
