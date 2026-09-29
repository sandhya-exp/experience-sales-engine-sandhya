"use client";

import { useState, useTransition } from "react";
import { updateStageAction } from "@/app/actions/leads";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";
import { LOST_REASONS } from "@/lib/dealSignals";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

/**
 * Manual stage control. Per the approved architecture, activity/qualification
 * can SUGGEST a stage move (see updateQualification in the leads repo) but
 * the sales user must always be able to override it here — a logged call
 * never forces a stage change on its own.
 *
 * Marking a deal Lost asks why first. The reason is the one piece of data a
 * lost deal leaves behind that the team can act on ("we lose on price to X"),
 * so it is captured at the moment it is known rather than reconstructed later.
 */
export function StageSelect({ leadId, status }: { leadId: string; status: LeadStatus }) {
  const [pending, startTransition] = useTransition();
  const [askLost, setAskLost] = useState(false);
  const [reason, setReason] = useState<string>(LOST_REASONS[0]);
  const [note, setNote] = useState("");

  return (
    <>
      <Select
        value={status}
        disabled={pending}
        onValueChange={(value) => {
          if (value === "lost" && status !== "lost") {
            setAskLost(true);
            return;
          }
          startTransition(() => updateStageAction(leadId, value as LeadStatus));
        }}
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

      <Dialog open={askLost} onOpenChange={setAskLost}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Mark this deal as lost</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setAskLost(false);
              startTransition(() => updateStageAction(leadId, "lost", { reason, note }));
            }}
          >
            <div className="space-y-1">
              <Label>Why did we lose it?</Label>
              <Select value={reason} onValueChange={setReason}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LOST_REASONS.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="lost-note">Anything worth remembering</Label>
              <Textarea
                id="lost-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Went with Birdeye at $180/user; open to revisiting at renewal in Q2."
              />
            </div>
            <p className="text-[12px] text-muted-foreground">Recorded on the timeline. Reports groups lost deals by this reason.</p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setAskLost(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                Mark as lost
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
