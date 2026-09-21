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
