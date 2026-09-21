import { query, queryOne } from "@/lib/db";
import type { Company } from "@/lib/types";

// Free-mail domains are never used for company matching/dedup — an inquiry
// from a gmail address always creates (or requires manually picking) a
// company, per the approved architecture (section 7 / P0 dedupe rule).
const FREE_MAIL_DOMAINS = new Set([
  "gmail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

export function extractDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at === -1) return null;
  const domain = email.slice(at + 1).toLowerCase().trim();
  if (!domain || FREE_MAIL_DOMAINS.has(domain)) return null;
  return domain;
}

/**
 * Deterministic P0 company matching: look up by domain only. No fuzzy
 * name-matching. Returns the existing company if the domain matches, or
 * creates a new one if not (or if the email is free-mail, domain === null).
 */
export async function findOrCreateCompanyForEmail(
  companyNameFromForm: string,
  email: string,
  industry?: string | null
): Promise<{ company: Company; matched: boolean }> {
  const domain = extractDomain(email);

  if (domain) {
    const existing = await queryOne<Company>("select * from companies where domain = $1", [domain]);
    if (existing) {
      // Same company, second inquiry: keep the record, but learn the industry if we didn't know it.
      if (!existing.industry && industry) {
        const updated = await queryOne<Company>("update companies set industry = $2 where id = $1 returning *", [existing.id, industry]);
        return { company: (updated as Company) ?? existing, matched: true };
      }
      return { company: existing, matched: true };
    }
  }

  const created = await queryOne<Company>(
    `insert into companies (name, domain, industry) values ($1, $2, $3) returning *`,
    [companyNameFromForm, domain, industry ?? null]
  );
  return { company: created as Company, matched: false };
}

export async function listCompanies(): Promise<Company[]> {
  return query<Company>("select * from companies order by created_at desc");
}

export interface CompanyRow extends Company {
  contact_count: number;
  opportunity_count: number;
  open_count: number;
  won_count: number;
  /** Stage of the most recently created opportunity — what this account is doing now. */
  latest_status: string | null;
  latest_lead_id: string | null;
  primary_contact_name: string | null;
  primary_contact_email: string | null;
  owner_name: string | null;
  last_activity_at: string | null;
  total_users: number | null;
}

/**
 * Accounts view: every company we already know, with its contacts and its
 * opportunities rolled up. Reads the existing companies/contacts/leads tables —
 * there is no separate "account" record, which is exactly what stops a rep
 * creating a second company for a customer who is already here.
 */
export async function listCompanyRows(): Promise<CompanyRow[]> {
  return query<CompanyRow>(`
    select
      co.*,
      (select count(*)::int from contacts ct where ct.company_id = co.id) as contact_count,
      (select count(*)::int from leads l where l.company_id = co.id) as opportunity_count,
      (select count(*)::int from leads l where l.company_id = co.id and l.status not in ('won','lost')) as open_count,
      (select count(*)::int from leads l where l.company_id = co.id and l.status = 'won') as won_count,
      (select sum(l.number_of_users)::int from leads l where l.company_id = co.id) as total_users,
      lt.status as latest_status,
      lt.id as latest_lead_id,
      u.name as owner_name,
      pc.name as primary_contact_name,
      pc.email as primary_contact_email,
      (select max(a.occurred_at) from activities a join leads l on l.id = a.lead_id where l.company_id = co.id) as last_activity_at
    from companies co
    left join lateral (
      select id, status, owner_user_id from leads l where l.company_id = co.id order by l.created_at desc limit 1
    ) lt on true
    left join app_users u on u.id = lt.owner_user_id
    left join lateral (
      select name, email from contacts ct where ct.company_id = co.id order by ct.is_primary desc, ct.created_at asc limit 1
    ) pc on true
    order by co.created_at desc
  `);
}
