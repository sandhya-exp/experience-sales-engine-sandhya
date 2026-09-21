import { query, queryOne, getPool } from "@/lib/db";
import type { Lead, LeadListRow, LeadStatus, Qualification } from "@/lib/types";
import { recordActivity } from "@/lib/repo/activities";

export interface CreateLeadInput {
  companyId: string;
  primaryContactId: string;
  numberOfUsers: number;
  /** Null when the inquiry described the need in its own words instead of picking an area. */
  interest: string | null;
  requirements: string | null;
  additionalInfo?: string | null;
  /** Where the inquiry came from, for the timeline: "website inquiry form", "API (branvidia)", … */
  source?: string;
}

export async function createLead(input: CreateLeadInput): Promise<Lead> {
  const lead = await queryOne<Lead>(
    `insert into leads (company_id, primary_contact_id, number_of_users, interest, requirements, additional_info, status)
     values ($1, $2, $3, $4, $5, $6, 'new')
     returning *`,
    [input.companyId, input.primaryContactId, input.numberOfUsers, input.interest, input.requirements, input.additionalInfo ?? null]
  );
  await recordActivity({
    leadId: (lead as Lead).id,
    type: "note",
    body: `Lead created from ${input.source ?? "customer inquiry"}.`,
    actorName: "System",
  });
  return lead as Lead;
}

export async function getLeadById(id: string): Promise<Lead | null> {
  return queryOne<Lead>("select * from leads where id = $1", [id]);
}

/** Dashboard rows: one query, with company/contact joins and derived columns. */
export async function listLeadRows(): Promise<LeadListRow[]> {
  return query<LeadListRow>(`
    select
      l.*,
      c.name as company_name,
      c.domain as company_domain,
      c.industry as company_industry,
      ct.name as primary_contact_name,
      -- Everything searchable about this lead in one lowercase blob so the
      -- dashboard's search matches any contact (not just the primary), emails,
      -- domain and interest without a second query.
      lower(concat_ws(' ',
        c.name, c.domain, l.interest,
        (select string_agg(concat_ws(' ', x.name, x.email), ' ') from contacts x where x.company_id = c.id)
      )) as search_text,
      u.name as owner_name,
      la.occurred_at as last_activity_at,
      la.type as last_activity_type,
      fu.scheduled_for as follow_up_at,
      fu.title as follow_up_title,
      b.next_action,
      coalesce(b.missing_info, '[]'::jsonb) as missing_info
    from leads l
    join companies c on c.id = l.company_id
    left join contacts ct on ct.id = l.primary_contact_id
    left join app_users u on u.id = l.owner_user_id
    left join lateral (
      select occurred_at, type from activities
      where lead_id = l.id order by occurred_at desc limit 1
    ) la on true
    left join lateral (
      select (metadata->>'scheduled_for')::timestamptz as scheduled_for, metadata->>'title' as title
      from activities
      where lead_id = l.id and metadata->>'kind' = 'follow_up'
        and coalesce((metadata->>'completed')::boolean, false) = false
      order by (metadata->>'scheduled_for')::timestamptz desc limit 1
    ) fu on true
    left join lateral (
      select next_action, missing_info from ai_deal_briefs
      where lead_id = l.id order by generated_at desc limit 1
    ) b on true
    order by l.created_at desc
  `);
}

export async function updateLeadStatus(id: string, status: LeadStatus, actorName: string): Promise<Lead> {
  const previous = await getLeadById(id);
  const updated = await queryOne<Lead>(
    `update leads set status = $2 ${status === "quoted" ? ", quote_requested_at = now()" : ""} where id = $1 returning *`,
    [id, status]
  );
  if (previous && previous.status !== status) {
    await recordActivity({
      leadId: id,
      type: "status_change",
      body: `Stage changed from ${previous.status} to ${status}.`,
      actorName,
    });
  }
  return updated as Lead;
}

export async function updateQualification(
  id: string,
  qualification: Qualification,
  qualificationStatus: "not_started" | "in_progress" | "qualified",
  actorName: string
): Promise<Lead> {
  const updated = await queryOne<Lead>(
    `update leads set qualification = $2::jsonb, qualification_status = $3 where id = $1 returning *`,
    [id, JSON.stringify(qualification), qualificationStatus]
  );
  await recordActivity({
    leadId: id,
    type: "qualification_change",
    body: "Qualification information updated.",
    actorName,
  });

  // If qualification reaches "qualified" and the lead is still earlier in
  // the pipeline than Qualified, suggest (but do not force) progressing the
  // stage — the sales user still makes the actual call, per the approved
  // architecture (stage management: suggest, never force on a single action).
  if (qualificationStatus === "qualified") {
    const lead = updated as Lead;
    if (lead.status === "new" || lead.status === "contacted") {
      return updateLeadStatus(id, "qualified", actorName);
    }
  }
  return updated as Lead;
}

export async function markQuoted(id: string, actorName: string): Promise<Lead> {
  return updateLeadStatus(id, "quoted", actorName);
}

export async function ensureSeedOwnerAssigned(leadId: string, ownerUserId: string) {
  await getPool().query("update leads set owner_user_id = $2 where id = $1 and owner_user_id is null", [
    leadId,
    ownerUserId,
  ]);
}

/**
 * Hand a lead to a team member (or back to Unassigned). Logged on the timeline
 * so coverage changes — "Sadhana is on leave, Marcus takes Nova" — are visible.
 */
export async function assignLeadOwner(
  leadId: string,
  ownerUserId: string | null,
  actorName: string,
  reason?: string | null
): Promise<Lead> {
  const previous = await getLeadById(leadId);
  const prevOwner = previous?.owner_user_id
    ? await queryOne<{ name: string }>("select name from app_users where id = $1", [previous.owner_user_id])
    : null;
  const nextOwner = ownerUserId
    ? await queryOne<{ name: string }>("select name from app_users where id = $1", [ownerUserId])
    : null;
  const updated = await queryOne<Lead>("update leads set owner_user_id = $2 where id = $1 returning *", [leadId, ownerUserId]);
  if (previous?.owner_user_id !== ownerUserId) {
    const body = nextOwner
      ? prevOwner
        ? `Reassigned from ${prevOwner.name} to ${nextOwner.name}${reason ? ` — ${reason}` : ""}.`
        : `Assigned to ${nextOwner.name}${reason ? ` (${reason})` : ""}.`
      : `Unassigned${prevOwner ? ` from ${prevOwner.name}` : ""}${reason ? ` — ${reason}` : ""}.`;
    await recordActivity({
      leadId,
      type: "note",
      body,
      actorName,
      metadata: { kind: "assignment", owner_user_id: ownerUserId, previous_owner_user_id: previous?.owner_user_id ?? null },
    });
  }
  return updated as Lead;
}
