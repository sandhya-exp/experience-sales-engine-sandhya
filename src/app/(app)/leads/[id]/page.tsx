import { notFound } from "next/navigation";
import { getWorkspaceData } from "@/lib/repo/workspace";
import { LeadHeader } from "@/components/workspace/lead-header";
import { WorkspaceTabs } from "@/components/workspace/workspace-tabs";
import { OverviewTab } from "@/components/workspace/overview-tab";
import { ContactsTab } from "@/components/workspace/contacts-tab";
import { ActivityTab } from "@/components/workspace/activity-tab";
import { QualificationTab } from "@/components/workspace/qualification-tab";
import { AiBriefTab } from "@/components/workspace/ai-brief-tab";
import { nextFollowUpFor } from "@/lib/repo/followups";
import { listTeam } from "@/lib/repo/users";
import { hasContractAccess, hasQuoteApproval } from "@/lib/authz";
import { hasIntelligence } from "@/lib/ai/briefGuards";
import { currentAgentActionFor, latestCustomerReply } from "@/lib/repo/agentActions";
import { latestCallRecap } from "@/lib/repo/callRecap";
import { listBriefHistory } from "@/lib/repo/aiBriefs";
import { listQuotesForLead, activeQuote, formatMoney } from "@/lib/repo/quotes";
import { QuotesTab } from "@/components/workspace/quotes-tab";
import { NextStepBanner } from "@/components/workspace/next-step-banner";
import { autoModeFor } from "@/lib/ai/actions";
import { emailProvider } from "@/lib/email/provider";

export default async function LeadWorkspacePage({ params, searchParams }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "overview";
  const focus = typeof sp.focus === "string" ? sp.focus : null;

  const data = await getWorkspaceData(id);
  if (!data) notFound();

  const { lead, company, contacts, activities, brief, ownerName } = data;
  const [followUp, team, canContract, canApprove, agentAction, autoMode, lastReply, callRecap, briefHistory, quotes] = await Promise.all([
    nextFollowUpFor(lead.id),
    listTeam(),
    hasContractAccess(),
    hasQuoteApproval(),
    currentAgentActionFor(lead.id),
    autoModeFor(lead.id),
    latestCustomerReply(lead.id),
    latestCallRecap(lead.id),
    listBriefHistory(lead.id),
    listQuotesForLead(lead.id),
  ]);
  const quote = activeQuote(quotes);
  const provider = emailProvider();
  const providerLabel = provider.mode === "live" ? `Sending via ${provider.name}` : "Development provider — messages are recorded, not delivered";
  const focusField = hasIntelligence(brief) ? (brief.intelligence.next_action.field ?? brief.intelligence.gaps.missing.find((m) => m.field)?.field ?? null) : null;

  return (
    <div>
      <LeadHeader
        lead={lead}
        company={company}
        ownerName={ownerName}
        followUp={followUp}
        team={team}
        contacts={contacts}
        focusField={focusField}
        canContract={canContract}
        quote={quote}
      />
      {/* The conclusion, above the tabs: what to do next, with a link to why. */}
      <div className="px-6 pt-5">
        <NextStepBanner leadId={lead.id} brief={brief} action={agentAction} />
      </div>
      <div className="mx-auto max-w-6xl px-6 py-6">
        <WorkspaceTabs
          defaultTab={tab}
          overview={<OverviewTab lead={lead} company={company} brief={brief} contacts={contacts} activities={activities} />}
          contacts={<ContactsTab leadId={lead.id} companyId={company.id} contacts={contacts} />}
          activity={<ActivityTab leadId={lead.id} activities={activities} briefs={briefHistory} quotes={quotes} leadCreatedAt={lead.created_at} companyName={company.name} />}
          qualification={<QualificationTab lead={lead} contacts={contacts} focus={focus} />}
          quotes={<QuotesTab leadId={lead.id} lead={lead} company={company} quotes={quotes} isAdmin={canApprove} intelligence={hasIntelligence(brief) ? brief.intelligence : null} />}
          brief={
            <AiBriefTab
              leadId={lead.id}
              brief={brief}
              canContract={canContract}
              action={agentAction}
              autoMode={autoMode}
              providerLabel={providerLabel}
              lastReply={lastReply}
              callRecap={callRecap}
              quote={quote ? { version: quote.meta.version, status: quote.meta.status, total: formatMoney(quote.meta.total) } : null}
            />
          }
        />
      </div>
    </div>
  );
}
