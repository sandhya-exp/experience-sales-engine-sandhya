import { getLeadById } from "@/lib/repo/leads";
import { queryOne } from "@/lib/db";
import { listContactsForCompany } from "@/lib/repo/contacts";
import { listActivitiesForLead } from "@/lib/repo/activities";
import { saveBrief } from "@/lib/repo/aiBriefs";
import { generateDealBrief, type DealBriefContext } from "@/lib/ai/dealBrief";
import type { OpportunityDataSource } from "@/lib/ai/tools";
import type { Company } from "@/lib/types";

export async function getLeadContextOrThrow(leadId: string): Promise<DealBriefContext> {
  const lead = await getLeadById(leadId);
  if (!lead) throw new Error("Lead not found");
  const company = await queryOne<Company>("select * from companies where id = $1", [lead.company_id]);
  const contacts = await listContactsForCompany(lead.company_id);
  const activities = await listActivitiesForLead(leadId);
  return { lead, company: company as Company, contacts, activities };
}

/** The AI workflow's read-only tools, backed by the application database. */
export const dbSource: OpportunityDataSource = {
  async getOpportunity(leadId) {
    const lead = await getLeadById(leadId);
    if (!lead) return null;
    const company = await queryOne<Company>("select * from companies where id = $1", [lead.company_id]);
    return company ? { lead, company } : null;
  },
  getContacts: (companyId) => listContactsForCompany(companyId),
  getActivities: (leadId) => listActivitiesForLead(leadId),
};

/**
 * Regenerate and persist the brief for one lead. The only write in the AI
 * path — and it writes the brief, never the opportunity.
 */
export async function regenerateBriefFor(ctx: DealBriefContext) {
  const generated = await generateDealBrief(ctx, dbSource);
  return saveBrief(
    ctx.lead.id,
    {
      summary: generated.summary,
      missingInfo: generated.missingInfo,
      nextAction: generated.nextAction,
      nextActionReason: generated.nextActionReason,
      keyFacts: generated.keyFacts,
      intelligence: generated.intelligence,
    },
    generated.generatedBy
  );
}
