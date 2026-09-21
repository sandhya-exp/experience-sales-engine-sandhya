import { query, queryOne } from "@/lib/db";
import type { AiDealBrief } from "@/lib/types";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";

export async function getLatestBrief(leadId: string): Promise<AiDealBrief | null> {
  return queryOne<AiDealBrief>(
    "select * from ai_deal_briefs where lead_id = $1 order by generated_at desc limit 1",
    [leadId]
  );
}

export async function listBriefHistory(leadId: string): Promise<AiDealBrief[]> {
  return query<AiDealBrief>("select * from ai_deal_briefs where lead_id = $1 order by generated_at desc", [leadId]);
}

export async function saveBrief(
  leadId: string,
  brief: { summary: string; missingInfo: string[]; nextAction: string; nextActionReason: string; keyFacts: string[]; intelligence: OpportunityIntelligence },
  generatedBy: string
): Promise<AiDealBrief> {
  const saved = await queryOne<AiDealBrief>(
    `insert into ai_deal_briefs (lead_id, summary, missing_info, next_action, next_action_reason, key_facts, generated_by, intelligence)
     values ($1, $2, $3::jsonb, $4, $5, $6::jsonb, $7, $8::jsonb)
     returning *`,
    [
      leadId,
      brief.summary,
      JSON.stringify(brief.missingInfo),
      brief.nextAction,
      brief.nextActionReason,
      JSON.stringify(brief.keyFacts),
      generatedBy,
      JSON.stringify(brief.intelligence),
    ]
  );
  return saved as AiDealBrief;
}
