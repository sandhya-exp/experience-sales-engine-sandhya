"use client";

import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Copy, FilePlus2, Pencil, Plus, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import { format, addDays } from "date-fns";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createQuoteAction, draftNarrativeAction, updateDraftAction } from "@/app/actions/quotes";
import type { QuoteNarrative } from "@/lib/ai/narrative";
import { computeTotals, endOfTerm, lineNet, netUnitPrice, type QuoteLineItem } from "@/lib/quotes/math";
import type { QuoteMeta } from "@/lib/repo/quotes";
import { lineApproval, type DiscountRules } from "@/lib/quotes/rules";
import { cn } from "@/lib/utils";

/**
 * The quote line editor.
 *
 * A quote is the one screen where a salesperson does arithmetic in front of a
 * customer's expectations, so the editor is built around the three questions
 * they are actually answering while they type: what is this deal's shape (when
 * it starts, how long it runs), what is on it line by line, and where does that
 * land against the number the customer said. Every one of those is on screen at
 * once and recalculates as they type — the point of a line editor rather than a
 * form is that nothing waits until save to become true.
 *
 * Two things here are judgements rather than layout. Each line carries its own
 * approval badge, because the quote-level chain tells a rep that *something*
 * needs a manager but not which line to reconsider. And the target amount is
 * shown as a distance, not a verdict: being over the customer's stated budget
 * is a normal thing to do deliberately, and the editor's job is to make sure it
 * is deliberate.
 */
export function QuoteFormDialog({
  leadId,
  existing,
  activityId,
  trigger,
  rules,
  targetAmount,
  companyName,
}: {
  leadId: string;
  existing?: QuoteMeta | null;
  activityId?: string;
  trigger?: "create" | "edit";
  rules: DiscountRules;
  /** What the customer said they had, when they said a figure. */
  targetAmount?: number | null;
  companyName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const editing = Boolean(existing && activityId);

  const [items, setItems] = useState<QuoteLineItem[]>(existing?.line_items?.length ? existing.line_items : [blankLine()]);
  const [startDate, setStartDate] = useState(existing?.start_date ?? format(new Date(), "yyyy-MM-dd"));
  const [termMonths, setTermMonths] = useState(String(existing?.term_months ?? 12));
  const [addlDiscount, setAddlDiscount] = useState(String(existing?.additional_discount_pct ?? 0));
  const [taxPct, setTaxPct] = useState(String(existing?.tax_pct ?? 0));
  const [target, setTarget] = useState(existing?.target_amount != null ? String(existing.target_amount) : targetAmount ? String(targetAmount) : "");
  const [note, setNote] = useState(existing?.notes ?? "");
  const [narrative, setNarrative] = useState<QuoteNarrative | null>(null);
  const [drafting, setDrafting] = useState(false);

  const totals = useMemo(
    () => computeTotals(items, { additional_discount_pct: num(addlDiscount), tax_pct: num(taxPct) }),
    [items, addlDiscount, taxPct]
  );

  const endDate = useMemo(() => endOfTerm(startDate, num(termMonths)), [startDate, termMonths]);
  const targetNum = num(target);
  const gap = targetNum > 0 ? totals.total - targetNum : null;

  // The strongest authority this quote calls for: whichever is higher, the
  // effective discount overall or the deepest single line. A rep should not have
  // to work out which of the two is the one holding the quote up.
  const approval = [lineApproval(totals.discount_pct, rules), ...items.map((it) => lineApproval(it.discount_pct, rules))].reduce((worst, a) =>
    RANK[a] > RANK[worst] ? a : worst
  , "ok" as ApprovalLevel);

  const set = (i: number, patch: Partial<QuoteLineItem>) => setItems((cur) => cur.map((it, idx) => (idx === i ? { ...it, ...patch } : it)));

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger === "edit" ? (
          <Button size="sm" variant="outline" className="gap-1.5">
            <Pencil className="h-3.5 w-3.5" /> Edit draft
          </Button>
        ) : (
          <Button size="sm" className="gap-1.5">
            <FilePlus2 className="h-3.5 w-3.5" /> {existing ? "Draft new version" : "Create quote"}
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-baseline gap-2">
            {editing ? `Quote v${existing!.version}` : existing ? `Quote v${existing.version + 1}` : "Quote"}
            <span className="text-[12.5px] font-normal text-muted-foreground">
              Line editor{companyName ? ` · ${companyName}` : ""}
              {existing && !editing ? ` · new version from v${existing.version}` : ""}
            </span>
          </DialogTitle>
        </DialogHeader>

        <form
          action={(fd) =>
            start(async () => {
              const r = editing ? await updateDraftAction(activityId!, fd) : await createQuoteAction(leadId, fd);
              if (r.ok) {
                toast.success(r.detail);
                setOpen(false);
              } else toast.error(r.detail);
            })
          }
          className="space-y-4"
          id={FORM_ID}
        >
          {/* ------------------------------------------------ quote information */}
          <section className="rounded-lg border border-border bg-muted/20 p-3">
            <p className="section-label mb-2">Quote information</p>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
              <Field label="Start date" htmlFor="q-start">
                <Input id="q-start" name="start_date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="h-8" />
              </Field>
              <Field label="Term (months)" htmlFor="q-term">
                <Input id="q-term" name="term_months" type="number" min={1} max={120} step={1} value={termMonths} onChange={(e) => setTermMonths(e.target.value)} className="h-8" />
              </Field>
              <Field label="End date">
                <p className="flex h-8 items-center rounded-md border border-dashed border-border px-2 text-[13px] tabular-nums text-muted-foreground">{endDate ? format(new Date(`${endDate}T00:00:00`), "d MMM yyyy") : "—"}</p>
              </Field>
              <Field label="Additional disc. %" htmlFor="q-addl">
                <Input id="q-addl" name="additional_discount_pct" type="number" min={0} max={100} step="0.5" value={addlDiscount} onChange={(e) => setAddlDiscount(e.target.value)} className="h-8 text-right" />
              </Field>
              <Field label="Tax %" htmlFor="q-tax">
                <Input id="q-tax" name="tax_pct" type="number" min={0} max={100} step="0.5" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} className="h-8 text-right" />
              </Field>
              <Field label="Target amount" htmlFor="q-target">
                <Input id="q-target" name="target_amount" type="number" min={0} step="0.01" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="—" className="h-8 text-right" />
              </Field>
            </div>

            {gap !== null && (
              <p className={cn("mt-2 text-[12px]", Math.abs(gap) < 1 ? "text-muted-foreground" : gap > 0 ? "text-amber-700 dark:text-amber-500" : "text-muted-foreground")}>
                {Math.abs(gap) < 1
                  ? `On target at ${money(totals.total)}.`
                  : gap > 0
                    ? `${money(gap)} above the ${money(targetNum)} the customer indicated — a manager approves anything over it.`
                    : `${money(-gap)} under the ${money(targetNum)} the customer indicated.`}
              </p>
            )}
          </section>

          {/* ------------------------------------------------------- line editor */}
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[840px] text-[13px]">
                <thead className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="w-8 px-2 py-1.5 text-left font-semibold">#</th>
                    <th className="px-2 py-1.5 text-left font-semibold">Product / service</th>
                    <th className="w-20 px-2 py-1.5 text-right font-semibold">Qty</th>
                    <th className="w-28 px-2 py-1.5 text-right font-semibold">List unit price</th>
                    <th className="w-24 px-2 py-1.5 text-right font-semibold">Disc %</th>
                    <th className="w-24 px-2 py-1.5 text-right font-semibold">Net unit</th>
                    <th className="w-24 px-2 py-1.5 text-center font-semibold">Approval</th>
                    <th className="w-28 px-2 py-1.5 text-right font-semibold">Net total</th>
                    <th className="w-16" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {items.map((it, i) => {
                    const a = lineApproval(it.discount_pct, rules);
                    return (
                      <tr key={i} className={cn(a !== "ok" && "bg-amber-50/50 dark:bg-amber-950/10")}>
                        <td className="px-2 py-1 text-[12px] tabular-nums text-muted-foreground">{i + 1}</td>
                        <td className="px-1.5 py-1">
                          <Input
                            name={`item_${i}_description`}
                            value={it.description}
                            onChange={(e) => set(i, { description: e.target.value })}
                            placeholder="e.g. Reputation Management — 60 users"
                            className="h-8"
                            required
                          />
                        </td>
                        <td className="px-1.5 py-1">
                          <Input name={`item_${i}_quantity`} type="number" min={0} step={1} value={it.quantity} onChange={(e) => set(i, { quantity: Number(e.target.value) })} className="h-8 text-right" />
                        </td>
                        <td className="px-1.5 py-1">
                          <Input name={`item_${i}_unit_price`} type="number" min={0} step="0.01" value={it.unit_price} onChange={(e) => set(i, { unit_price: Number(e.target.value) })} className="h-8 text-right" />
                        </td>
                        <td className="px-1.5 py-1">
                          <Input name={`item_${i}_discount_pct`} type="number" min={0} max={100} step="0.5" value={it.discount_pct} onChange={(e) => set(i, { discount_pct: Number(e.target.value) })} className="h-8 text-right" />
                        </td>
                        <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{money(netUnitPrice(it))}</td>
                        <td className="px-2 py-1 text-center">
                          <ApprovalBadge level={a} />
                        </td>
                        <td className="px-2 py-1 text-right font-medium tabular-nums text-foreground">{money(lineNet(it))}</td>
                        <td className="px-1 py-1">
                          <div className="flex items-center justify-end gap-0.5">
                            <button
                              type="button"
                              aria-label={`Duplicate line ${i + 1}`}
                              title="Duplicate"
                              className="rounded p-1 text-muted-foreground hover:text-foreground"
                              onClick={() => setItems((cur) => [...cur.slice(0, i + 1), { ...cur[i] }, ...cur.slice(i + 1)])}
                            >
                              <Copy className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              aria-label={`Remove line ${i + 1}`}
                              title="Remove"
                              className="rounded p-1 text-muted-foreground hover:text-destructive disabled:opacity-30"
                              disabled={items.length === 1}
                              onClick={() => setItems((cur) => cur.filter((_, idx) => idx !== i))}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-start justify-between gap-4 border-t border-border bg-muted/30 px-2 py-2">
              <Button type="button" size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={() => setItems((cur) => [...cur, blankLine()])}>
                <Plus className="h-3.5 w-3.5" /> Add line
              </Button>

              <dl className="w-full space-y-1 rounded-md border border-border bg-card px-3 py-2 text-[12.5px] tabular-nums sm:w-auto sm:min-w-[280px]">
                <Row label="Subtotal" value={money(totals.subtotal)} />
                {totals.line_discount_total > 0 && <Row label="Line discounts" value={`−${money(totals.line_discount_total)}`} />}
                {totals.additional_discount_total > 0 && <Row label={`Additional discount (${num(addlDiscount)}%)`} value={`−${money(totals.additional_discount_total)}`} />}
                <Row label={`Net amount${totals.discount_pct > 0 ? ` · ${totals.discount_pct}% off` : ""}`} value={money(totals.net_amount)} />
                {totals.tax_total > 0 && <Row label={`Tax (${num(taxPct)}%)`} value={money(totals.tax_total)} />}
                <div className="flex items-center justify-between border-t border-border pt-1 font-semibold text-foreground">
                  <dt>Quote total</dt>
                  <dd>{money(totals.total)}</dd>
                </div>
              </dl>
            </div>
          </div>

          {approval !== "ok" && (
            <p className="flex items-start gap-2 rounded-md border border-amber-300/60 bg-amber-50 px-2.5 py-2 text-[12.5px] text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/20 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>
                At {totals.discount_pct}% this needs {approval === "admin" ? "a sales manager and an admin" : "a sales manager"} to approve before it can go to the customer. A rep may give up to {rules.managerPct}% alone.
              </span>
            </p>
          )}

          {/* --------------------------------------------------------- the terms */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="q-valid">Valid until</Label>
              <Input id="q-valid" name="valid_until" type="date" defaultValue={existing?.valid_until ?? format(addDays(new Date(), 30), "yyyy-MM-dd")} min={format(new Date(), "yyyy-MM-dd")} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="q-terms">Terms</Label>
              <Input id="q-terms" name="terms" defaultValue={existing?.terms ?? "Annual subscription, billed annually. Net 30."} />
            </div>
          </div>
          {/* The narrative. The AI writes the first version from the record and
              the lines above; the rep owns every word that actually goes out. */}
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Label htmlFor="q-notes">Note to the customer</Label>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 text-xs"
                disabled={drafting}
                onClick={async () => {
                  const form = document.getElementById(FORM_ID) as HTMLFormElement | null;
                  if (!form) return;
                  setDrafting(true);
                  try {
                    const r = await draftNarrativeAction(leadId, new FormData(form));
                    if (r.ok && r.narrative) {
                      setNote(r.narrative.note);
                      setNarrative(r.narrative);
                      if (r.narrative.reason) toast.message(r.narrative.reason);
                    } else toast.error(r.detail);
                  } finally {
                    setDrafting(false);
                  }
                }}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {drafting ? "Drafting…" : note ? "Redraft with AI" : "Draft with AI"}
              </Button>
            </div>
            <Textarea id="q-notes" name="notes" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What this quote covers, in your words — or let the AI draft it from the record." />
            {narrative && (
              <p className="text-[11px] text-muted-foreground">
                {narrative.generated_by === "claude" ? "Drafted by Claude" : "Assembled from the record"}
                {narrative.grounded_in.length > 0 && <> from {narrative.grounded_in.join("; ")}</>}. It cannot promise an outcome or mention the discount — edit it before it goes out.
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-md text-[11px] text-muted-foreground">
              The quote is checked against the discount threshold, the customer&rsquo;s stated budget and qualification before it can be sent.
            </p>
            <div className="flex items-center gap-3">
              <span className="text-[13px] tabular-nums text-muted-foreground">
                Total <strong className="font-semibold text-foreground">{money(totals.total)}</strong>
              </span>
              <Button type="submit" disabled={pending}>
                {pending ? "Saving…" : editing ? "Save draft" : "Create draft"}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// The narrative is drafted from the form the rep is still filling in, so the
// button needs to read that form rather than any saved quote.
const FORM_ID = "quote-line-editor";

type ApprovalLevel = "ok" | "manager" | "admin";
const RANK: Record<ApprovalLevel, number> = { ok: 0, manager: 1, admin: 2 };

function ApprovalBadge({ level }: { level: ApprovalLevel }) {
  if (level === "ok") return <span className="text-[11.5px] text-muted-foreground">—</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
        level === "admin" ? "bg-destructive/10 text-destructive" : "bg-amber-100 text-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
      )}
    >
      <ShieldCheck className="h-3 w-3" />
      {level === "admin" ? "Admin" : "Manager"}
    </span>
  );
}

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label htmlFor={htmlFor} className="text-[11px] font-medium text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-muted-foreground">
      <dt>{label}</dt>
      <dd className="text-foreground">{value}</dd>
    </div>
  );
}

function blankLine(): QuoteLineItem {
  return { description: "", quantity: 1, unit_price: 0, discount_pct: 0 };
}

function num(v: string) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function money(n: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(n || 0);
}
