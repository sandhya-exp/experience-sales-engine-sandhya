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

export interface BriefRow {
  lead_id: string;
  summary: string;
  next_action: string;
  next_action_reason: string | null;
  missing_info: string[];
  generated_by: string;
  generated_at: string;
  intelligence: OpportunityIntelligence | Record<string, never>;
}

/**
 * The newest brief per opportunity, in one query — what the Home dashboard's
 * AI Insights section reads. No regeneration happens here: this is a read of
 * what the orchestrator already produced and saved.
 */
export async function listLatestBriefs(): Promise<BriefRow[]> {
  return query<BriefRow>(`
    select distinct on (lead_id)
      lead_id, summary, next_action, next_action_reason,
      coalesce(missing_info, '[]'::jsonb) as missing_info,
      generated_by, generated_at, coalesce(intelligence, '{}'::jsonb) as intelligence
    from ai_deal_briefs
    order by lead_id, generated_at desc
  `);
}
