import Link from "next/link";
import { Bot, CheckCircle2, Clock, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { AgentActionListRow } from "@/lib/repo/agentActions";

/**
 * AI actions on Home.
 *
 * The question this answers is not "how many things does the AI think" but
 * "what is the agent doing, and what does it need from me". So the three
 * numbers are operational states, not a score: what is sitting waiting for a
 * person, what ran on its own, and what is out with a customer. Every count is
 * a filter over the stored actions — nothing here is estimated.
 */
export function AgentActionsPanel({ actions }: { actions: AgentActionListRow[] }) {
  const waitingApproval = actions.filter((a) => a.meta.state === "proposed" && a.meta.risk !== "green");
  const readyToRun = actions.filter((a) => a.meta.state === "proposed" && a.meta.risk === "green");
  const handled = actions.filter((a) => a.meta.state === "executed" && a.meta.auto);
  const waitingCustomer = actions.filter((a) => a.meta.state === "executed" && a.meta.action_type === "ask_customer" && !a.meta.replied_at);

  const queue = [...waitingApproval, ...readyToRun, ...waitingCustomer].slice(0, 4);

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-navy text-white">
            <Bot className="h-3.5 w-3.5" />
          </span>
          AI actions
        </CardTitle>
        <Link href="/tasks?kind=agent_approval" className="text-[13px] font-medium text-primary hover:underline">
          Open
        </Link>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {actions.length === 0 ? (
          <p className="py-4 text-center text-[13px] text-muted-foreground">
            No agent actions yet. One is proposed whenever an opportunity has a gap the agent can help close.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat icon={ShieldAlert} value={waitingApproval.length} label="waiting for approval" tone={waitingApproval.length ? "warn" : "muted"} />
              <Stat icon={Bot} value={readyToRun.length} label="safe to run" tone={readyToRun.length ? "navy" : "muted"} />
              <Stat icon={CheckCircle2} value={handled.length} label="handled automatically" tone={handled.length ? "ok" : "muted"} />
              <Stat icon={Clock} value={waitingCustomer.length} label="waiting for customer" tone="muted" />
            </dl>

            {queue.length > 0 && (
              <ul className="divide-y divide-border rounded-lg border border-border">
                {queue.map((a) => (
                  <li key={a.activityId}>
                    <Link href={`/leads/${a.leadId}?tab=brief`} className="flex items-start gap-3 px-3 py-2.5 transition-colors hover:bg-muted/50">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] font-medium text-foreground">{a.companyName}</p>
                        <p className="truncate text-[12.5px] text-muted-foreground">{a.meta.goal}</p>
                      </div>
                      <StateChip row={a} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function Stat({ icon: Icon, value, label, tone }: { icon: React.ComponentType<{ className?: string }>; value: number; label: string; tone: "warn" | "ok" | "navy" | "muted" }) {
  const color = tone === "warn" ? "text-warning" : tone === "ok" ? "text-success" : tone === "navy" ? "text-navy" : "text-muted-foreground";
  return (
    <div className="rounded-lg border border-border px-2.5 py-2">
      <dt className="sr-only">{label}</dt>
      <dd>
        <p className={cn("flex items-center gap-1.5 text-xl font-semibold tabular-nums", color)}>
          <Icon className="h-4 w-4" />
          {value}
        </p>
        <p className="mt-0.5 text-[11.5px] leading-tight text-muted-foreground">{label}</p>
      </dd>
    </div>
  );
}

function StateChip({ row }: { row: AgentActionListRow }) {
  if (row.meta.state === "executed") return <Badge variant="outline">Waiting for reply</Badge>;
  if (row.meta.risk === "green") return <Badge variant="success">Send</Badge>;
  return <Badge variant="warning">Review</Badge>;
}
