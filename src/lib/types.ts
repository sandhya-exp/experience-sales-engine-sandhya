import { DOWNSTREAM } from "@/lib/modules";

export type LeadStatus = "new" | "contacted" | "qualified" | "quoted" | "won" | "lost";

export const LEAD_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "qualified",
  "quoted",
  "won",
  "lost",
];

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New Leads",
  contacted: "Contacted",
  qualified: "Qualified",
  quoted: DOWNSTREAM.name,
  won: "Won",
  lost: "Lost",
};

export type ActivityType = "call" | "email" | "message" | "note" | "status_change" | "qualification_change";

export type QualificationStatus = "not_started" | "in_progress" | "qualified";

export interface Qualification {
  number_of_users?: number | null;
  current_solution?: string | null;
  primary_need?: string | null;
  decision_timeline?: string | null;
  decision_maker?: string | null;
  budget?: string | null;
}

export interface Company {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  created_at: string;
}

export interface Contact {
  id: string;
  company_id: string;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface Lead {
  id: string;
  company_id: string;
  primary_contact_id: string | null;
  owner_user_id: string | null;
  number_of_users: number | null;
  interest: string | null;
  requirements: string | null;
  additional_info: string | null;
  status: LeadStatus;
  qualification: Qualification;
  qualification_status: QualificationStatus;
  quote_requested_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Activity {
  id: string;
  lead_id: string;
  type: ActivityType;
  body: string | null;
  actor_user_id: string | null;
  actor_name: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
}

import type { OpportunityIntelligence } from "@/lib/ai/intelligence";

export interface AiDealBrief {
  id: string;
  lead_id: string;
  summary: string;
  missing_info: string[];
  next_action: string;
  next_action_reason: string | null;
  key_facts: string[];
  generated_by: string;
  generated_at: string;
  /** Structured AI Opportunity Intelligence; {} on rows written before it existed. */
  intelligence: OpportunityIntelligence | Record<string, never>;
}

export interface LeadListRow extends Lead {
  company_name: string;
  company_domain: string | null;
  company_industry: string | null;
  primary_contact_name: string | null;
  search_text: string;
  owner_name: string | null;
  last_activity_at: string | null;
  last_activity_type: ActivityType | null;
  follow_up_at: string | null;
  follow_up_title: string | null;
  next_action: string | null;
  missing_info: string[];
}
