import { queryOne } from "@/lib/db";
import { getLeadById } from "@/lib/repo/leads";
import { listContactsForCompany } from "@/lib/repo/contacts";
import { listActivitiesForLead } from "@/lib/repo/activities";
import { getLatestBrief } from "@/lib/repo/aiBriefs";
import type { Company } from "@/lib/types";

export async function getWorkspaceData(leadId: string) {
  const lead = await getLeadById(leadId);
  if (!lead) return null;
  const [company, contacts, activities, brief, owner] = await Promise.all([
    queryOne<Company>("select * from companies where id = $1", [lead.company_id]),
    listContactsForCompany(lead.company_id),
    listActivitiesForLead(leadId),
    getLatestBrief(leadId),
    lead.owner_user_id
      ? queryOne<{ name: string }>("select name from app_users where id = $1", [lead.owner_user_id])
      : Promise.resolve(null),
  ]);
  return {
    lead,
    company: company as Company,
    contacts,
    activities,
    brief,
    ownerName: owner?.name ?? "Unassigned",
  };
}
