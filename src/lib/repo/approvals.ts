import { query } from "@/lib/db";

/**
 * The approval queue for steps an AI tool may ask for but never perform:
 * sending a message to the customer and marking a deal Won. Stored as an
 * activity (metadata.kind = "approval_request") on the opportunity — no new
 * table — and resolved only by a signed-in person clicking Approve or Decline.
 */
export const APPROVAL_REQUEST_KIND = "approval_request";

export interface ApprovalRequestMeta {
  kind: typeof APPROVAL_REQUEST_KIND;
  action: "send_customer_message" | "mark_opportunity_won";
  state: "pending" | "approved" | "declined";
  requested_by: string;
  requested_at: string;
  subject?: string;
  message?: string;
  reason?: string | null;
  resolved_by?: string;
  resolved_at?: string;
  outcome?: string;
}

export interface ApprovalRequestRow {
  activityId: string;
  leadId: string;
  meta: ApprovalRequestMeta;
}

export async function pendingApprovals(leadId: string): Promise<ApprovalRequestRow[]> {
  const rows = await query<{ id: string; lead_id: string; metadata: ApprovalRequestMeta }>(
    `select id, lead_id, metadata from activities where lead_id = $1 and metadata->>'kind' = $2 and metadata->>'state' = 'pending' order by occurred_at desc`,
    [leadId, APPROVAL_REQUEST_KIND]
  );
  return rows.map((r) => ({ activityId: r.id, leadId: r.lead_id, meta: r.metadata }));
}

export async function getApproval(activityId: string): Promise<ApprovalRequestRow | null> {
  const rows = await query<{ id: string; lead_id: string; metadata: ApprovalRequestMeta }>(`select id, lead_id, metadata from activities where id = $1 and metadata->>'kind' = $2`, [activityId, APPROVAL_REQUEST_KIND]);
  return rows[0] ? { activityId: rows[0].id, leadId: rows[0].lead_id, meta: rows[0].metadata } : null;
}
