import { query, queryOne } from "@/lib/db";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  /** Open (not won/lost) leads currently owned — the load-balancing signal. */
  open_leads: number;
}

/** Everyone who can own a lead, with their current open-deal load. */
export async function listTeam(): Promise<TeamMember[]> {
  return query<TeamMember>(`
    select u.id, u.name, u.email,
      (select count(*)::int from leads l where l.owner_user_id = u.id and l.status not in ('won','lost')) as open_leads
    from app_users u
    order by u.name
  `);
}

export async function getUserByEmail(email: string) {
  return queryOne<{ id: string; name: string; email: string }>(
    "select id, name, email from app_users where email = $1",
    [email.toLowerCase().trim()]
  );
}
