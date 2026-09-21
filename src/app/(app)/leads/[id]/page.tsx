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
import { hasContractAccess } from "@/lib/authz";
import { hasIntelligence } from "@/components/workspace/ai-brief-card";

export default async function LeadWorkspacePage({ params, searchParams }: PageProps<"/leads/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "overview";
  const focus = typeof sp.focus === "string" ? sp.focus : null;

  const data = await getWorkspaceData(id);
  if (!data) notFound();

  const { lead, company, contacts, activities, brief, ownerName } = data;
  const [followUp, team, canContract] = await Promise.all([nextFollowUpFor(lead.id), listTeam(), hasContractAccess()]);
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
      />
      <div className="mx-auto max-w-6xl px-6 py-6">
        <WorkspaceTabs
          defaultTab={tab}
          overview={<OverviewTab lead={lead} company={company} brief={brief} contacts={contacts} activities={activities} />}
          contacts={<ContactsTab leadId={lead.id} companyId={company.id} contacts={contacts} />}
          activity={<ActivityTab leadId={lead.id} activities={activities} />}
          qualification={<QualificationTab lead={lead} contacts={contacts} focus={focus} />}
          brief={<AiBriefTab leadId={lead.id} brief={brief} canContract={canContract} />}
        />
      </div>
    </div>
  );
}
