import { query } from "@/lib/db";

/**
 * "A new inquiry arrived" — read straight off the leads table, no separate
 * notifications store. A lead is an unread notification until the signed-in
 * user has opened the bell after it was created (per-user cursor in a cookie).
 */
export interface InquiryNotification {
  lead_id: string;
  company_name: string;
  contact_name: string | null;
  number_of_users: number | null;
  interest: string | null;
  source: string | null;
  created_at: string;
}

export async function listRecentInquiries(limit = 8): Promise<InquiryNotification[]> {
  return query<InquiryNotification>(
    `select l.id as lead_id, c.name as company_name, ct.name as contact_name, l.number_of_users, l.interest,
            (select a.body from activities a where a.lead_id = l.id order by a.occurred_at asc limit 1) as source,
            l.created_at
     from leads l
     join companies c on c.id = l.company_id
     left join contacts ct on ct.id = l.primary_contact_id
     where l.created_at > now() - interval '7 days'
     order by l.created_at desc
     limit $1`,
    [limit]
  );
}
