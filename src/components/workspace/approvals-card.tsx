"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { resolveApprovalAction } from "@/app/actions/approvals";
import type { ApprovalRequestRow } from "@/lib/repo/approvals";

/** Steps an AI tool asked for but may not take itself. Nothing here happens until a person clicks Approve. */
export function ApprovalsCard({ requests }: { requests: ApprovalRequestRow[] }) {
  const [pending, start] = useTransition();
  if (!requests.length) return null;
  const act = (id: string, d: "approve" | "decline") =>
    start(async () => {
      const r = await resolveApprovalAction(id, d);
      if (r.ok) toast.success(r.detail);
      else toast.error(r.detail);
    });
  return (
    <Card className="border-amber-300/60">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-amber-600" /> Waiting for your approval
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-[13px]">
        {requests.map((r) => (
          <div key={r.activityId} className="rounded-lg border border-border p-3">
            <p className="font-medium text-foreground">
              {r.meta.action === "send_customer_message" ? `Send to customer: “${r.meta.subject}”` : "Mark this opportunity Won"}
            </p>
            <p className="text-[12px] text-muted-foreground">Requested by {r.meta.requested_by} · {new Date(r.meta.requested_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</p>
            {r.meta.message && <p className="mt-2 whitespace-pre-wrap rounded bg-muted/40 p-2 text-[12.5px]">{r.meta.message}</p>}
            {r.meta.reason && <p className="mt-1 text-[12.5px]">{r.meta.reason}</p>}
            <div className="mt-2 flex gap-2">
              <Button size="sm" disabled={pending} onClick={() => act(r.activityId, "approve")}>
                {r.meta.action === "send_customer_message" ? "Approve & send" : "Approve · mark Won"}
              </Button>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => act(r.activityId, "decline")}>
                Decline
              </Button>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
