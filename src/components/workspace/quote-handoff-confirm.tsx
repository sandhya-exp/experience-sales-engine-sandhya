"use client";

import { DOWNSTREAM } from "@/lib/modules";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { createQuoteHandoffAction, type HandoffResult } from "@/app/actions/leads";

type Phase = "idle" | "sending" | "opening";

export function QuoteHandoffConfirm({
  leadId,
  alreadyQuoted,
  requoting = false,
}: {
  leadId: string;
  alreadyQuoted: boolean;
  requoting?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [phase, setPhase] = useState<Phase>("idle");
  const router = useRouter();

  const run = () =>
    startTransition(async () => {
      setPhase("sending");
      let result: HandoffResult;
      try {
        result = await createQuoteHandoffAction(leadId);
      } catch (err) {
        setPhase("idle");
        toast.error(err instanceof Error ? err.message : "Handoff failed");
        return;
      }

      if (result.url) {
        setPhase("opening");
        toast.success(
          result.status === "delivered"
            ? `Quote context handed to ${DOWNSTREAM.partner}.`
            : `Handoff recorded — ${DOWNSTREAM.partner} will pick it up when it is back online.`
        );
        // The downstream module is embedded on the Quote Ready page, opened on this opportunity.
        router.push(`${DOWNSTREAM.route}?lead=${leadId}`);
        return;
      }

      // Partner module URL not configured in this environment: the handoff is
      // still recorded; show the outcome on the lead's timeline.
      toast.success("Handoff recorded on the timeline.");
      router.push(`/leads/${leadId}?tab=activity`);
    });

  const busy = pending || phase !== "idle";

  return (
    <Button size="lg" className="w-full" disabled={busy} onClick={run}>
      {phase === "sending" && (
        <>
          <Loader2 className="h-4 w-4 animate-spin" /> Sending…
        </>
      )}
      {phase === "opening" && (
        <>
          <CheckCircle2 className="h-4 w-4" /> Opening…
        </>
      )}
      {phase === "idle" && (
        <>
          {alreadyQuoted ? DOWNSTREAM.openLabel : requoting ? DOWNSTREAM.updateLabel : DOWNSTREAM.continueLabel} <ArrowRight className="h-4 w-4" />
        </>
      )}
    </Button>
  );
}
