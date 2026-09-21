"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2 } from "lucide-react";
import { DOWNSTREAM } from "@/lib/modules";
import { toast } from "sonner";
import { prepareGuidedSellingAction } from "@/app/actions/leads";
import { Button } from "@/components/ui/button";
import type { LeadStatus } from "@/lib/types";
import type { QualField } from "@/lib/ai/intelligence";

/**
 * The one handoff control, in the opportunity header.
 *   gaps remain   → Complete Qualification →   (opens the missing field)
 *   ready         → Continue to Quote Ready → (verifies, finalizes quote context, marks Quote Ready, opens the review)
 *   handed off    → nothing (stage says Quote Ready; the sidebar entry opens the module)
 */
export function CreateQuoteButton({
  leadId,
  status,
  complete,
  focusField,
  canContract,
}: {
  leadId: string;
  status: LeadStatus;
  complete: boolean;
  focusField: QualField | null;
  /** Admin only. A Sales User still completes qualification — they just don't hand over. */
  canContract: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [missing, setMissing] = useState<string[] | null>(null);

  // Handed off: the stage selector already says Quote Ready/Won and the
  // sidebar's Quote Ready entry is the way in — nothing to duplicate here.
  if (status === "quoted" || status === "won" || status === "lost") return null;

  if (!complete) {
    const href = focusField === "contact" ? `/leads/${leadId}?tab=contacts` : `/leads/${leadId}?tab=qualification${focusField ? `&focus=${focusField}` : ""}`;
    return (
      <Button asChild size="lg" variant="outline">
        <Link href={href}>
          Complete Qualification <ArrowRight className="h-4 w-4" />
        </Link>
      </Button>
    );
  }

  // Qualified, but the handoff is not this role's step. The opportunity is
  // complete and visible; the boundary is simply not theirs to cross.
  if (!canContract) return null;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="lg"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const result = await prepareGuidedSellingAction(leadId);
            if (!result.ok) {
              setMissing(result.missing);
              toast.error("A few qualification details are still missing.");
              return;
            }
            router.push(`/leads/${leadId}/quote`);
          })
        }
      >
        {pending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" /> Preparing…
          </>
        ) : (
          <>
            {DOWNSTREAM.continueLabel} <ArrowRight className="h-4 w-4" />
          </>
        )}
      </Button>
      {missing && missing.length > 0 && <span className="text-xs text-warning">Missing: {missing.join(", ")}</span>}
    </div>
  );
}
