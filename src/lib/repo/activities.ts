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
