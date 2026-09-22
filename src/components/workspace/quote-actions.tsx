"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { CheckCircle2, Copy, Eye, MessageSquare, Send, ShieldCheck, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { approveQuoteAction, cloneVersionAction, markQuoteAction, recallQuoteAction, requestQuoteChangesAction, sendQuoteAction } from "@/app/actions/quotes";
import type { QuoteStatus } from "@/lib/repo/quotes";

/** The primary actions for the active quote, chosen by its state. One row, no menus. */
export function QuoteActions({ activityId, status, needsApproval, isAdmin, version }: { activityId: string; status: QuoteStatus; needsApproval: boolean; isAdmin: boolean; version: number }) {
  const [pending, start] = useTransition();
  const run = (fn: () => Promise<{ ok: boolean; detail: string }>) =>
    start(async () => {
      const r = await fn();
      if (r.ok) toast.success(r.detail);
      else toast.error(r.detail);
    });

  // A rep builds the quote; an admin releases it. The server enforces this —
  // these controls only avoid offering a button that would be refused, and say
  // why instead, so nobody sits waiting on an action they cannot take.
  const sendable = (status === "draft" && !needsApproval) || status === "approved" || status === "recalled";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {status === "draft" && needsApproval && isAdmin && (
        <>
          <Button size="sm" disabled={pending} onClick={() => run(() => approveQuoteAction(activityId))}>
            <ShieldCheck className="h-3.5 w-3.5" /> Approve
          </Button>
          <RequestChanges activityId={activityId} version={version} disabled={pending} />
        </>
      )}
      {status === "draft" && needsApproval && !isAdmin && <Waiting>Waiting on a manager to approve this before it can go out.</Waiting>}
      {sendable && isAdmin && (
        <Button size="sm" disabled={pending} onClick={() => run(() => sendQuoteAction(activityId))}>
          <Send className="h-3.5 w-3.5" /> Send to customer
        </Button>
      )}
      {sendable && !isAdmin && <Waiting>Ready to go out — a manager sends it to the customer.</Waiting>}
      {(status === "sent" || status === "viewed") && (
        <>
          {status === "sent" && (
            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => markQuoteAction(activityId, "viewed"))}>
              <Eye className="h-3.5 w-3.5" /> Customer viewed
            </Button>
          )}
          <Button size="sm" disabled={pending} onClick={() => run(() => markQuoteAction(activityId, "accepted"))}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Customer accepted
          </Button>
          {isAdmin && (
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => run(() => recallQuoteAction(activityId))}>
              <Undo2 className="h-3.5 w-3.5" /> Recall
            </Button>
          )}
        </>
      )}
      {status !== "draft" && (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => cloneVersionAction(activityId))}>
          <Copy className="h-3.5 w-3.5" /> Clone as new version
        </Button>
      )}
    </div>
  );
}

/**
 * The other answer an approver has.
 *
 * Approving is one button; the useful refusal is a sentence — "fine at 30% if
 * the term goes to 24 months" — so it asks for one rather than letting the
 * quote sit unapproved with the reason in someone's head.
 */
function RequestChanges({ activityId, version, disabled }: { activityId: string; version: number; disabled: boolean }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline" disabled={disabled}>
          <MessageSquare className="h-3.5 w-3.5" /> Request changes
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Request changes to quote v{version}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-[12.5px] text-muted-foreground">
            It goes back to the owner as a draft, and any approval already given on it is cleared — the numbers are about to move.
          </p>
          <Textarea
            aria-label="What needs to change"
            rows={3}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. 30% works at a 24-month term — reprice and resubmit."
          />
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={pending || !note.trim()}
              onClick={() =>
                start(async () => {
                  const r = await requestQuoteChangesAction(activityId, note);
                  if (r.ok) {
                    toast.success(r.detail);
                    setNote("");
                    setOpen(false);
                  } else toast.error(r.detail);
                })
              }
            >
              {pending ? "Sending…" : "Send back"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-[12.5px] text-muted-foreground">
      <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
      {children}
    </span>
  );
}
