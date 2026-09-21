import { query, queryOne, getPool } from "@/lib/db";
import type { Contact } from "@/lib/types";
import { recordActivity } from "@/lib/repo/activities";

export async function createPrimaryContact(companyId: string, name: string, email: string, phone?: string | null, title?: string | null): Promise<Contact> {
  const contact = await queryOne<Contact>(
    `insert into contacts (company_id, name, email, phone, title, is_primary)
     values ($1, $2, $3, $4, $5, true)
     returning *`,
    [companyId, name, email, phone ?? null, title ?? null]
  );
  return contact as Contact;
}

export async function findContactByEmail(companyId: string, email: string): Promise<Contact | null> {
  return queryOne<Contact>("select * from contacts where company_id = $1 and email = $2", [companyId, email]);
}

// Used by the customer-facing inquiry flow. Company de-dup means a second
// inquiry from the same domain can arrive with a contact email that either
// (a) already exists for that company — just reuse it, or (b) is a new
// person at a company that already has a primary contact — add them as a
// secondary contact rather than violating the one-primary-per-company rule.
export async function findOrCreateContactForInquiry(
  companyId: string,
  name: string,
  email: string,
  phone?: string | null
): Promise<Contact> {
  const existing = await findContactByEmail(companyId, email);
  if (existing) return existing;

  const hasPrimary = await queryOne<{ exists: boolean }>(
    "select exists(select 1 from contacts where company_id = $1 and is_primary) as exists",
    [companyId]
  );
  const makePrimary = !hasPrimary?.exists;

  const contact = await queryOne<Contact>(
    `insert into contacts (company_id, name, email, phone, is_primary)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [companyId, name, email, phone ?? null, makePrimary]
  );
  return contact as Contact;
}

export async function listContactsForCompany(companyId: string): Promise<Contact[]> {
  return query<Contact>("select * from contacts where company_id = $1 order by is_primary desc, created_at asc", [companyId]);
}

export async function addContact(
  companyId: string,
  input: { name: string; email: string; phone?: string | null; title?: string | null; makePrimary?: boolean },
  leadIdForActivity: string,
  actorName: string
): Promise<Contact> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (input.makePrimary) {
      await client.query("update contacts set is_primary = false where company_id = $1", [companyId]);
    }
    const { rows } = await client.query<Contact>(
      `insert into contacts (company_id, name, email, phone, title, is_primary)
       values ($1, $2, $3, $4, $5, $6)
       returning *`,
      [companyId, input.name, input.email, input.phone ?? null, input.title ?? null, Boolean(input.makePrimary)]
    );
    if (input.makePrimary) {
      await client.query("update leads set primary_contact_id = $2 where company_id = $1", [companyId, rows[0].id]);
    }
    await client.query("commit");
    await recordActivity({
      leadId: leadIdForActivity,
      type: "note",
      body: `Added contact ${input.name}${input.makePrimary ? " as primary contact" : ""}.`,
      actorName,
    });
    return rows[0];
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
