"use client";

import { useTransition } from "react";
import { updateStageAction } from "@/app/actions/leads";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Manual stage control. Per the approved architecture, activity/qualification
 * can SUGGEST a stage move (see updateQualification in the leads repo) but
 * the sales user must always be able to override it here — a logged call
 * never forces a stage change on its own.
 */
export function StageSelect({ leadId, status }: { leadId: string; status: LeadStatus }) {
  const [pending, startTransition] = useTransition();

  return (
    <Select
      value={status}
      disabled={pending}
      onValueChange={(value) => startTransition(() => updateStageAction(leadId, value as LeadStatus))}
    >
      <SelectTrigger className="h-8 w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {LEAD_STATUSES.map((s) => (
          <SelectItem key={s} value={s}>
            {LEAD_STATUS_LABELS[s]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
