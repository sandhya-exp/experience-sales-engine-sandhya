"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Calculator, Database, FilePlus2, ShieldCheck, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { createDraftFromProposalAction, prepareQuoteAction } from "@/app/actions/quoteAgent";
import type { QuoteProposal } from "@/lib/ai/quoteAgent";
import type { SalesToolCall } from "@/lib/ai/salesTools";

/**
 * "Prepare quote with AI" — the agentic quote flow, visible step by step:
 * history → products → list prices → calculation → discount check → coverage.
 * The rep sees every tool call and every source, then creates the draft.
 */
export function QuotePrepCard({ leadId }: { leadId: string }) {
  const [proposal, setProposal] = useState<QuoteProposal | null>(null);
  const [draftTrace, setDraftTrace] = useState<SalesToolCall[]>([]);
  const [pending, start] = useTransition();
  const [creating, startCreate] = useTransition();

  const run = () =>
    start(async () => {
      const r = await prepareQuoteAction(leadId);
      if (!r.ok || !r.proposal) return void toast.error(r.detail);
      setProposal(r.proposal);
      setDraftTrace([]);
    });

  const create = () =>
    proposal &&
    startCreate(async () => {
      const r = await createDraftFromProposalAction(leadId, proposal.lines);
      setDraftTrace(r.trace ?? []);
      if (r.ok) toast.success(r.detail);
      else toast.error(r.detail);
    });

  const p = proposal?.priced;
  const money = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" /> Prepare quote with AI
        </CardTitle>
        <Button size="sm" variant={proposal ? "outline" : "default"} onClick={run} disabled={pending}>
          {pending ? "Preparing…" : proposal ? "Run again" : "Prepare quote"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4 text-[13px]">
        {!proposal ? (
          <p className="text-muted-foreground">
            The agent reads this customer&rsquo;s history and current contract, picks products from the catalog, prices them from the price list, and checks the discount against the rules. It creates nothing until you say so.
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{proposal.generated_by === "claude" ? `Claude · ${proposal.model}` : "Deterministic"}</Badge>
              <Badge variant="outline">{proposal.price_list.label}</Badge>
              {p && (
                <Badge className={cn(p.approval === "ok" ? "bg-success/10 text-success" : "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200")}>
                  {p.approval === "ok" ? "Within rep authority" : `Needs ${p.approval} approval`}
                </Badge>
              )}
            </div>
            {proposal.fallback_reason && <p className="text-[12px] italic text-muted-foreground">{proposal.fallback_reason}</p>}
            <p className="text-foreground">{proposal.rationale}</p>
            {proposal.evidence.length > 0 && (
              <ul className="list-disc pl-5 text-[12px] text-muted-foreground">
                {proposal.evidence.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}

            {p && p.lines.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[560px] text-[12.5px]">
                  <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5 text-left">Product</th>
                      <th className="px-2 py-1.5 text-right">Qty</th>
                      <th className="px-2 py-1.5 text-right">List price</th>
                      <th className="px-2 py-1.5 text-right">Disc</th>
                      <th className="px-2 py-1.5 text-left">Discount check</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {p.lines.map((l, i) => (
                      <tr key={i}>
                        <td className="px-2 py-1.5">{l.description}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.quantity}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{money(l.list_price)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{l.discount_pct}%</td>
                        <td className="px-2 py-1.5 text-muted-foreground">{l.discount_check.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="flex flex-wrap justify-end gap-x-6 gap-y-1 border-t border-border bg-muted/30 px-3 py-2 text-[12.5px]">
                  <span className="text-muted-foreground">Subtotal {money(p.totals.subtotal)}</span>
                  <span className="text-muted-foreground">Discount −{money(p.totals.discount_total)}</span>
                  <span className="font-semibold text-foreground">Total {money(p.totals.total)}</span>
                </div>
              </div>
            )}

            {(proposal.missing.length > 0 || proposal.issues.length > 0 || (p?.approval_reasons.length ?? 0) > 0) && (
              <div className="space-y-1 rounded-md border border-border bg-card px-3 py-2 text-[12.5px]">
                {p?.approval_reasons.map((r, i) => (
                  <p key={`a${i}`} className="flex gap-1.5"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />{r}</p>
                ))}
                {proposal.missing.length > 0 && <p>Not covered: {proposal.missing.join(", ")}</p>}
                {proposal.issues.map((r, i) => (
                  <p key={`i${i}`} className="text-muted-foreground">{r}</p>
                ))}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={create} disabled={creating || !p?.lines.length} className="gap-1.5">
                <FilePlus2 className="h-3.5 w-3.5" /> {creating ? "Creating…" : "Create draft quote"}
              </Button>
              <span className="text-[12px] text-muted-foreground">Creates a draft only. Approvals and sending stay with people.</span>
            </div>

            <TraceList calls={[...proposal.trace, ...draftTrace]} />
          </>
        )}
      </CardContent>
    </Card>
  );
}

const KIND_ICON = { read: Database, compute: Calculator, draft: FilePlus2, request: ShieldCheck } as const;

function TraceList({ calls }: { calls: SalesToolCall[] }) {
  return (
    <details className="rounded-lg border border-border">
      <summary className="cursor-pointer px-3 py-2 text-[12px] font-semibold uppercase tracking-wide text-muted-foreground">
        AI process · {calls.length} tool calls
      </summary>
      <ol className="divide-y divide-border text-[12px]">
        {calls.map((t, i) => {
          const Icon = KIND_ICON[t.kind];
          return (
            <li key={i} className="px-3 py-1.5">
              <p className="flex items-baseline gap-1.5">
                <span className="w-5 shrink-0 text-right tabular-nums text-muted-foreground">{i + 1}.</span>
                <Icon className="h-3 w-3 shrink-0 self-center text-muted-foreground" />
                <code className={cn("shrink-0 rounded px-1 py-0.5 font-mono text-[11px]", t.ok ? "bg-muted text-foreground" : "bg-destructive/10 text-destructive")}>{t.tool}</code>
                <span className="min-w-0 truncate text-muted-foreground" title={t.input}>{t.input}</span>
                <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">{t.duration_ms}ms</span>
              </p>
              <p className="mt-0.5 break-words pl-7 text-foreground">→ {t.output}</p>
              {t.sources.length > 0 && <p className="pl-7 text-[11px] text-muted-foreground">Source: {t.sources.join(" · ")}</p>}
            </li>
          );
        })}
      </ol>
    </details>
  );
}
