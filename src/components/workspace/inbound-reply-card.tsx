"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { confirmInboundReplyFactsAction } from "@/app/actions/inboundReply";
import type { InboundReplyRow } from "@/lib/repo/inboundReply";

/**
 * Inbound Email — what the automatic capture found in the customer's most
 * recent email reply, and a checklist to confirm what to keep.
 *
 * There is no "paste it yourself" input here, unlike Call Recap: this card
 * only ever shows what the inbound-email webhook already captured on its
 * own. The confirmation step is the same discipline either way — extraction
 * only proposes, quoting the customer's own words for every fact, and
 * nothing changes the opportunity's qualification or context until a person
 * checks a box and confirms it.
 */
export function InboundReplyCard({ leadId, latest }: { leadId: string; latest: InboundReplyRow | null }) {
  const [pending, startTransition] = useTransition();
  const [confirmed, setConfirmed] = useState<Set<number>>(new Set(latest?.meta.confirmed_indices ?? []));

  if (!latest) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-navy text-white">
              <Mail className="h-3.5 w-3.5" />
            </span>
            Inbound Email
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-[13px] text-muted-foreground">No email reply has been captured yet. This fills in on its own the moment the customer replies.</p>
        </CardContent>
      </Card>
    );
  }

  const items = [
    ...latest.meta.facts.map((f, i) => ({ index: i, label: f.label, value: f.value, quote: f.quote })),
    ...latest.meta.systems.map((s, j) => ({ index: latest.meta.facts.length + j, label: "System named", value: s.name, quote: s.quote })),
  ];
  const alreadyConfirmed = new Set(latest.meta.confirmed_indices);
  const canConfirmMore = items.some((it) => !alreadyConfirmed.has(it.index));

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
      const r = await confirmInboundReplyFactsAction(leadId, latest.activityId, fd);
      if (r.ok) toast.success(r.detail);
      else toast.error(r.detail);
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-navy text-white">
            <Mail className="h-3.5 w-3.5" />
          </span>
          Inbound Email
        </CardTitle>
        <span className="text-[11px] text-muted-foreground">Captured automatically</span>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
          <Badge variant={latest.meta.generated_by === "claude" ? "navy" : "secondary"}>{latest.meta.generated_by === "claude" ? "Claude" : "Deterministic"}</Badge>
          Received {new Date(latest.occurredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
          {latest.meta.subject && <span className="truncate">· “{latest.meta.subject}”</span>}
        </div>
        <p className="text-[13px] leading-relaxed text-foreground">{latest.meta.summary}</p>

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
        {items.length === 0 && <p className="text-[13px] text-muted-foreground">Nothing was extracted from this reply — it was still recorded on the timeline.</p>}
      </CardContent>
    </Card>
  );
}
