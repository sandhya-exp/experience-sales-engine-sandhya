import { query, queryOne } from "@/lib/db";
import type { Activity, ActivityType } from "@/lib/types";

export interface RecordActivityInput {
  leadId: string;
  type: ActivityType;
  body?: string | null;
  actorUserId?: string | null;
  actorName?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordActivity(input: RecordActivityInput): Promise<Activity> {
  const activity = await queryOne<Activity>(
    `insert into activities (lead_id, type, body, actor_user_id, actor_name, metadata)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     returning *`,
    [
      input.leadId,
      input.type,
      input.body ?? null,
      input.actorUserId ?? null,
      input.actorName ?? "System",
      JSON.stringify(input.metadata ?? {}),
    ]
  );
  return activity as Activity;
}

export async function listActivitiesForLead(leadId: string): Promise<Activity[]> {
  return query<Activity>("select * from activities where lead_id = $1 order by occurred_at desc", [leadId]);
}

export async function listRecentActivities(limit = 8): Promise<(Activity & { company_name: string })[]> {
  return query(
    `select a.*, c.name as company_name
     from activities a
     join leads l on l.id = a.lead_id
     join companies c on c.id = l.company_id
     order by a.occurred_at desc
     limit $1`,
    [limit]
  );
}

export interface ActivityFeedRow extends Activity {
  company_name: string;
  company_industry: string | null;
  lead_status: string;
  owner_user_id: string | null;
  owner_name: string | null;
}

/** Everything that happened across the pipeline, newest first, for the Activity view. */
export async function listActivityFeed(limit = 300): Promise<ActivityFeedRow[]> {
  return query<ActivityFeedRow>(
    `select a.*, c.name as company_name, c.industry as company_industry, l.status as lead_status,
            l.owner_user_id, u.name as owner_name
     from activities a
     join leads l on l.id = a.lead_id
     join companies c on c.id = l.company_id
     left join app_users u on u.id = l.owner_user_id
     order by a.occurred_at desc
     limit $1`,
    [limit]
  );
}

export interface ClearedItem {
  id: string;
  leadId: string;
  companyName: string;
  type: ActivityType;
  body: string | null;
  actorName: string | null;
  occurredAt: string;
}

/**
 * What the team has actually done since a moment — the other half of a task
 * list. Scheduled Tasks shows what is outstanding, which means a rep who has
 * just cleared five things sees no evidence of it; this reads the same
 * timeline from the other end.
 *
 * Only work a person did: automated records (routing, the first AI brief,
 * the inquiry itself) are logged as "System" and left out, because nobody
 * cleared them.
 */
export async function listClearedSince(since: Date, limit = 50): Promise<ClearedItem[]> {
  const rows = await query<{
    id: string;
    lead_id: string;
    company_name: string;
    type: ActivityType;
    body: string | null;
    actor_name: string | null;
    occurred_at: string;
  }>(
    `select a.id, a.lead_id, c.name as company_name, a.type, a.body, a.actor_name, a.occurred_at
     from activities a
     join leads l on l.id = a.lead_id
     join companies c on c.id = l.company_id
     where a.occurred_at >= $1
       and coalesce(a.actor_name, 'System') <> 'System'
       and coalesce(a.metadata->>'kind', '') not in ('assignment')
     order by a.occurred_at desc
     limit $2`,
    [since.toISOString(), limit]
  );
  return rows.map((r) => ({
    id: r.id,
    leadId: r.lead_id,
    companyName: r.company_name,
    type: r.type,
    body: r.body,
    actorName: r.actor_name,
    occurredAt: r.occurred_at,
  }));
}
