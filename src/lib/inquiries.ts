import { pickOwner } from "@/lib/routing";
import { listTeam } from "@/lib/repo/users";
import { assignLeadOwner } from "@/lib/repo/leads";
import { findOrCreateCompanyForEmail } from "@/lib/repo/companies";
import { findOrCreateContactForInquiry } from "@/lib/repo/contacts";
import { createLead } from "@/lib/repo/leads";
import { getLeadContextOrThrow, regenerateBriefFor } from "@/lib/ai/service";

/**
 * One way in for every inbound channel — the /inquire web form, the internal
 * New Lead dialog, and external systems (a website chat agent, a partner site,
 * an automation) posting to /api/inquiries. Same de-dup, same lead, same brief.
 */
// Validation lives in a client-safe module so the Talk to Sales form can apply the same rules inline.
import type { InquiryInput as InquiryInputType } from "@/lib/inquiry-schema";
export { InquiryInput, TalkToSalesInput } from "@/lib/inquiry-schema";

export async function createInquiryLead(data: InquiryInputType, source: string) {
  const { company, matched } = await findOrCreateCompanyForEmail(data.companyName, data.workEmail, data.industry ?? null);
  const contact = await findOrCreateContactForInquiry(company.id, data.contactName, data.workEmail, data.phone ?? null);
  const lead = await createLead({
    companyId: company.id,
    primaryContactId: contact.id,
    numberOfUsers: data.numberOfUsers,
    interest: data.interest ?? null,
    requirements: data.requirements ?? null,
    additionalInfo: data.additionalInfo ?? null,
    source,
  });

  // Route to an owner: the sector specialist for this industry, else whoever has
  // the fewest open deals. Logged on the timeline so the team can see why.
  try {
    const picked = pickOwner(await listTeam(), company.industry ?? data.industry ?? null);
    if (picked) await assignLeadOwner(lead.id, picked.owner.id, "System", picked.reason);
  } catch (err) {
    console.error("Lead routing failed (non-fatal, lead stays unassigned):", err);
  }

  // First AI Deal Brief straight away; failure here must never lose the lead.
  try {
    await regenerateBriefFor(await getLeadContextOrThrow(lead.id));
  } catch (err) {
    console.error("Initial AI brief generation failed (non-fatal):", err);
  }

  return { lead, company, contact, companyMatched: matched };
}
