"use client";

import { useState, useTransition } from "react";
import { UserRound, Check } from "lucide-react";
import { toast } from "sonner";
import { reassignLeadAction } from "@/app/actions/leads";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TeamMember } from "@/lib/repo/users";
import { cn } from "@/lib/utils";

/**
 * Who owns this deal. Anyone on the team can hand it to anyone else (or take it
 * themselves) with an optional reason — "covering while Sandhya is on leave".
 * The change is logged on the timeline, so coverage is never a mystery.
 */
export function OwnerSelect({
  leadId,
  ownerUserId,
  ownerName,
  team,
}: {
  leadId: string;
  ownerUserId: string | null;
  ownerName: string;
  team: TeamMember[];
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  const choose = (id: string | null, name: string) => {
    if (id === ownerUserId) return setOpen(false);
    start(async () => {
      await reassignLeadAction(leadId, id, reason);
      toast.success(id ? `Assigned to ${name}` : "Lead unassigned");
      setReason("");
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-9 gap-2" disabled={pending}>
          <UserRound className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="section-label !text-[10px]">Owner</span>
          <span className={cn("text-[13px] font-medium", !ownerUserId && "text-warning")}>{ownerName}</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Assign this deal</DialogTitle>
        </DialogHeader>
        <div className="space-y-1 px-2 pb-3">
          <Label htmlFor="reassign-reason" className="text-xs">
            Reason (optional — goes on the timeline)
          </Label>
          <Input
            id="reassign-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. covering while Sandhya is on leave"
            className="h-8 text-xs"
          />
        </div>
        <p className="section-label px-2 pb-1.5">Hand to</p>
        <ul className="max-h-60 space-y-0.5 overflow-y-auto">
          {team.map((m) => {
            const active = m.id === ownerUserId;
            return (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => choose(m.id, m.name)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-muted",
                    active && "bg-muted font-semibold"
                  )}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-primary">
                    {m.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{m.name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">{m.open_leads} open</span>
                  {active && <Check className="h-3.5 w-3.5 text-primary" />}
                </button>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => choose(null, "")}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[13px] text-muted-foreground hover:bg-muted",
                !ownerUserId && "bg-muted font-semibold text-foreground"
              )}
            >
              <span className="h-6 w-6 shrink-0 rounded-full border border-dashed border-border" />
              Unassigned
            </button>
          </li>
        </ul>
      </DialogContent>
    </Dialog>
  );
}
