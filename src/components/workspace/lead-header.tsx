import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { StageSelect } from "@/components/workspace/stage-select";
import { CreateQuoteButton } from "@/components/workspace/create-quote-button";
import { FollowUpChip } from "@/components/workspace/follow-up-chip";
import { OwnerSelect } from "@/components/workspace/owner-select";
import { StageTracker } from "@/components/workspace/stage-tracker";
import type { FollowUp } from "@/lib/repo/followups";
import type { TeamMember } from "@/lib/repo/users";
import type { Activity, Company, Contact, Lead } from "@/lib/types";
import { formatMoney, type QuoteRow } from "@/lib/repo/quotes";
import { LEAD_STATUS_LABELS } from "@/lib/types";
import { estimateDealValue, lostReasonFor, stageEnteredAt } from "@/lib/dealSignals";
import { daysSince } from "@/lib/format";
import { computeReadiness } from "@/lib/readiness";
import type { QualField } from "@/lib/ai/intelligence";
import { format } from "date-fns";

export function LeadHeader({
  lead,
  company,
  ownerName,
  followUp,
  team,
  contacts,
  focusField,
  canContract,
  quote = null,
  activities = [],
}: {
  lead: Lead;
  company: Company;
  ownerName: string;
  followUp: FollowUp | null;
  team: TeamMember[];
  contacts: Contact[];
  focusField: QualField | null;
  /** Admin only: the Continue to Contract handoff. Qualification itself is everyone's. */
  canContract: boolean;
  /** The active quote, when there is one — it lights the Quote step. */
  quote?: QuoteRow | null;
  /** The timeline, for "in this stage since" and the lost reason. */
  activities?: Activity[];
}) {
  const readiness = computeReadiness(lead, contacts);
  const closed = lead.status === "won" || lead.status === "lost";
  const stageDays = daysSince(stageEnteredAt(activities, lead.status, lead.created_at));
  const estimate = quote || closed ? null : estimateDealValue(lead);
  const lost = lead.status === "lost" ? lostReasonFor(activities) : null;
  const initials = company.name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="border-b border-border bg-card">
      <div className="mx-auto max-w-6xl px-6 pt-4">
        <Link href="/pipeline" className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Pipeline
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4 pb-4">
          <div className="flex items-center gap-3">
            <Avatar className="h-11 w-11">
              <AvatarFallback className="text-sm">{initials}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="text-lg font-semibold text-foreground">{company.name}</h1>
              <p className="text-xs text-muted-foreground">
                Created {format(new Date(lead.created_at), "MMM d, yyyy")}
                <span className="mx-1.5 text-border">·</span>
                {closed ? (
                  <>
                    {LEAD_STATUS_LABELS[lead.status]} {stageDays === 0 ? "today" : `${stageDays}d ago`}
                    {lost ? <span className="text-destructive"> — {lost.reason}</span> : null}
                  </>
                ) : (
                  <>
                    In {LEAD_STATUS_LABELS[lead.status]} {stageDays === 0 ? "since today" : `for ${stageDays} day${stageDays === 1 ? "" : "s"}`}
                  </>
                )}
                {quote ? (
                  <>
                    <span className="mx-1.5 text-border">·</span>
                    <span className="font-medium text-foreground tabular-nums">{formatMoney(quote.meta.total)}</span> quoted
                  </>
                ) : estimate ? (
                  <>
                    <span className="mx-1.5 text-border">·</span>
                    <span className="tabular-nums" title={`Estimate: ${estimate.basis}. Not a quote.`}>~{formatMoney(estimate.amount)} est.</span>
                  </>
                ) : null}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-start gap-3">
            <OwnerSelect leadId={lead.id} ownerUserId={lead.owner_user_id} ownerName={ownerName} team={team} />
            <StageSelect leadId={lead.id} status={lead.status} />
            <CreateQuoteButton
              leadId={lead.id}
              status={lead.status}
              complete={readiness.complete}
              focusField={focusField}
              canContract={canContract}
            />
          </div>
        </div>
        {/* Where the deal is, before anything else on the page. */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4">
          <StageTracker status={lead.status} quote={quote ? { version: quote.meta.version, status: quote.meta.status } : null} />
          {followUp && lead.status !== "won" && lead.status !== "lost" && <FollowUpChip leadId={lead.id} followUp={followUp} />}
        </div>
      </div>
    </div>
  );
}
