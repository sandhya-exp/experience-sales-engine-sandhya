"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, ChevronDown, Phone, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { processCallRecapAction, confirmCallRecapFactsAction } from "@/app/actions/callRecap";
import type { CallRecapRow } from "@/lib/repo/callRecap";
import { DEMO_CALL_TRANSCRIPTS } from "@/lib/demo/callTranscripts";

/**
 * Call Recap — paste a discovery-call transcript, let the AI read it, then
 * confirm which of what it found is worth keeping.
 *
 * Two steps, on purpose, mirroring how a customer reply is handled: the
 * extraction only ever proposes, quoting the customer's own words for every
 * fact, and nothing changes the opportunity's qualification or context until
 * a person checks a box and confirms it. The processed call becomes part of
 * the AI Summary's evidence the moment it's processed — that happens whether
 * or not any fact is ever confirmed.
 */
export function CallRecapCard({ leadId, latest }: { leadId: string; latest: CallRecapRow | null }) {
  const [pending, startTransition] = useTransition();
  const [transcript, setTranscript] = useState("");
  const [open, setOpen] = useState(!latest);
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set(latest?.meta.confirmed_indices ?? []));

  const items = latest
    ? [
        ...latest.meta.facts.map((f, i) => ({ index: i, label: f.label, value: f.value, quote: f.quote })),
        ...latest.meta.systems.map((s, j) => ({ index: latest.meta.facts.length + j, label: "System named", value: s.name, quote: s.quote })),
      ]
    : [];
  const alreadyConfirmed = new Set(latest?.meta.confirmed_indices ?? []);
  const canConfirmMore = items.some((it) => !alreadyConfirmed.has(it.index));

  function process() {
    const fd = new FormData();
    fd.set("transcript", transcript);
    startTransition(async () => {
      const r = await processCallRecapAction(leadId, fd);
      if (r.ok) {
        toast.success(r.detail);
        setTranscript("");
        setOpen(false);
      } else toast.error(r.detail);
    });
  }

  function confirm() {
    if (!latest) return;
    const toConfirm = [...confirmed].filter((i) => !alreadyConfirmed.has(i));
    if (!toConfirm.length) {
      toast.error("Select at least one new fact to confirm.");
      return;
    }
    const fd = new FormData();
    for (const i of toConfirm) fd.append("confirmed", String(i));
    startTransition(async () => {
      const r = await confirmCallRecapFactsAction(leadId, latest.activityId, fd);
      if (r.ok) toast.success(r.detail);
      else toast.error(r.detail);
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-navy text-white">
            <Phone className="h-3.5 w-3.5" />
          </span>
          Call Recap
        </CardTitle>
        <Button type="button" variant="ghost" size="sm" onClick={() => setOpen((o) => !o)} className="gap-1 text-muted-foreground">
          {latest ? "Process another call" : "Paste a transcript"} <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} />
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {!latest && !open && <p className="text-[13px] text-muted-foreground">No call has been processed yet. Paste a transcript to have the AI read it.</p>}

        {open && (
          <div className="space-y-2.5 rounded-md border border-border bg-muted/30 p-3.5">
            <Textarea
              rows={6}
              placeholder="Paste the call transcript here…"
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              className="bg-card text-[13px]"
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {DEMO_CALL_TRANSCRIPTS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTranscript(t.transcript)}
                    className="rounded-md border border-border bg-card px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                  >
                    Use &ldquo;{t.label}&rdquo;
                  </button>
                ))}
              </div>
              <Button type="button" size="sm" disabled={pending || !transcript.trim()} onClick={process} className="gap-1.5">
                <Sparkles className="h-3.5 w-3.5" /> {pending ? "Processing…" : "Process with AI"}
              </Button>
            </div>
          </div>
        )}

        {latest && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <Badge variant={latest.meta.generated_by === "claude" ? "navy" : "secondary"}>{latest.meta.generated_by === "claude" ? "Claude" : "Deterministic"}</Badge>
              Processed {new Date(latest.occurredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </div>
            <p className="text-[13px] leading-relaxed text-foreground">{latest.meta.summary}</p>
            {latest.meta.next_action && (
              <p className="rounded-md border border-primary/20 bg-accent/40 px-3 py-2 text-[13px] text-foreground">
                <span className="font-semibold">Suggested next action: </span>
                {latest.meta.next_action}
              </p>
            )}

            {items.length > 0 && (
              <div className="space-y-1.5">
                <p className="section-label">What the AI found — confirm what to keep</p>
                <ul className="space-y-1.5">
                  {items.map((it) => {
                    const already = alreadyConfirmed.has(it.index);
                    return (
                      <li key={it.index} className={cn("flex items-start gap-2 rounded-md border px-2.5 py-2 text-[13px]", already ? "border-success/30 bg-success/5" : "border-border bg-card")}>
                        {already ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                        ) : (
                          <input
                            type="checkbox"
                            className="mt-0.5 h-4 w-4 shrink-0 rounded-sm border-input"
                            checked={confirmed.has(it.index)}
                            onChange={(e) =>
                              setConfirmed((prev) => {
                                const next = new Set(prev);
                                if (e.target.checked) next.add(it.index);
                                else next.delete(it.index);
                                return next;
                              })
                            }
                          />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">
                            {it.label}: <span className="font-normal">{it.value}</span>
                          </p>
                          <p className="mt-0.5 truncate text-[12px] text-muted-foreground" title={it.quote}>
                            “{it.quote}”
                          </p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
                {latest.meta.note && <p className="text-[11px] text-muted-foreground">{latest.meta.note}</p>}
                {canConfirmMore && (
                  <Button type="button" size="sm" disabled={pending || confirmed.size === 0} onClick={confirm}>
                    {pending ? "Applying…" : "Confirm selected"}
                  </Button>
                )}
              </div>
            )}
            {items.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing was extracted from this call — it was still recorded on the timeline.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
