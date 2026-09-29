import { query, queryOne, getPool } from "@/lib/db";
import type { Contact } from "@/lib/types";
import { recordActivity } from "@/lib/repo/activities";
import type { ContactSource } from "@/lib/contacts/source";

/* ------------------------------------------------------------ provenance */

/**
 * `contacts.source` / `contacts.external_ref` are additive columns
 * (db/schema.sql). Until `npm run db:schema` has been run against a database
 * the app keeps working: inserts omit the columns and provenance reads null.
 * Checked once per process.
 */
let provenanceColumns: Promise<boolean> | null = null;
export function hasProvenanceColumns(): Promise<boolean> {
  provenanceColumns ??= queryOne<{ n: number }>(
    `select count(*)::int as n from information_schema.columns
      where table_name = 'contacts' and column_name in ('source', 'external_ref')`
  )
    .then((r) => (r?.n ?? 0) === 2)
    .catch(() => false);
  return provenanceColumns;
}

type Prov = { source?: ContactSource | null; external_ref?: string | null };

/** INSERT column list and values, with or without provenance. */
async function insertParts(base: Record<string, unknown>, prov: Prov) {
  const cols = Object.keys(base);
  const vals = Object.values(base);
  if (await hasProvenanceColumns()) {
    cols.push("source", "external_ref");
    vals.push(prov.source ?? null, prov.external_ref ?? null);
  }
  return { cols: cols.join(", "), placeholders: vals.map((_, i) => `$${i + 1}`).join(", "), vals };
}

export async function createPrimaryContact(companyId: string, name: string, email: string, phone?: string | null, title?: string | null, source: ContactSource = "manual"): Promise<Contact> {
  const { cols, placeholders, vals } = await insertParts({ company_id: companyId, name, email, phone: phone ?? null, title: title ?? null, is_primary: true }, { source });
  const contact = await queryOne<Contact>(`insert into contacts (${cols}) values (${placeholders}) returning *`, vals);
  return contact as Contact;
}

export async function findContactByEmail(companyId: string, email: string): Promise<Contact | null> {
  return queryOne<Contact>("select * from contacts where company_id = $1 and lower(email) = lower($2)", [companyId, email]);
}

export interface ContactMatch extends Contact {
  company_name: string;
  company_domain: string | null;
}

/** Every contact whose email is in the list, anywhere — the import's duplicate check. */
export async function findContactsByEmails(emails: string[]): Promise<ContactMatch[]> {
  const list = [...new Set(emails.map((e) => e.trim().toLowerCase()).filter(Boolean))];
  if (!list.length) return [];
  return query<ContactMatch>(
    `select ct.*, co.name as company_name, co.domain as company_domain
       from contacts ct join companies co on co.id = ct.company_id
      where lower(ct.email) = any($1::text[])
      order by ct.created_at asc`,
    [list]
  );
}

/**
 * Attribute an inbound message to the right opportunity from the sender's
 * email address alone — no companyId to scope by, unlike `findContactByEmail`.
 * A person can be a contact on more than one company's account over time, so
 * this picks the contact's most relevant lead: an open one (not won or lost)
 * first, falling back to the most recently updated lead otherwise. Used by
 * the inbound email webhook, which only ever has the "From" address to go on.
 */
export async function findLeadByContactEmail(email: string): Promise<{ contact: Contact; leadId: string } | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;
  const row = await queryOne<{ contact_id: string; lead_id: string }>(
    `select c.id as contact_id, l.id as lead_id
       from contacts c
       join leads l on l.company_id = c.company_id
      where lower(c.email) = lower($1)
      order by (l.status not in ('won', 'lost')) desc, l.updated_at desc
      limit 1`,
    [trimmed]
  );
  if (!row) return null;
  const contact = await queryOne<Contact>("select * from contacts where id = $1", [row.contact_id]);
  return contact ? { contact, leadId: row.lead_id } : null;
}

/**
 * Used by every inbound channel (Talk to Sales, New Lead dialog, /api/inquiries).
 *
 * Create *or update*: the customer typing their own details is the best
 * source there is, so an existing contact (matched by email within the
 * company) picks up a phone number or title they did not have before, and a
 * changed name is corrected. Company de-dup means a second inquiry from the
 * same domain can be (a) the same person — reuse and update — or (b) a new
 * person at a company that already has a primary contact — add them as a
 * secondary contact rather than violating the one-primary-per-company rule.
 */
export async function findOrCreateContactForInquiry(
  companyId: string,
  name: string,
  email: string,
  phone?: string | null,
  source: ContactSource = "talk_to_sales",
  title?: string | null
): Promise<Contact> {
  const existing = await findContactByEmail(companyId, email);
  if (existing) {
    const next = {
      name: name.trim() && name.trim() !== existing.name ? name.trim() : existing.name,
      phone: phone?.trim() || existing.phone,
      title: title?.trim() || existing.title,
    };
    const changed = next.name !== existing.name || next.phone !== existing.phone || next.title !== existing.title;
    const prov = await hasProvenanceColumns();
    if (!changed && (!prov || existing.source)) return existing;
    const updated = await queryOne<Contact>(
      prov
        ? `update contacts set name = $2, phone = $3, title = $4, source = coalesce(source, $5) where id = $1 returning *`
        : `update contacts set name = $2, phone = $3, title = $4 where id = $1 returning *`,
      prov ? [existing.id, next.name, next.phone, next.title, source] : [existing.id, next.name, next.phone, next.title]
    );
    return (updated as Contact) ?? existing;
  }

  const hasPrimary = await queryOne<{ exists: boolean }>(
    "select exists(select 1 from contacts where company_id = $1 and is_primary) as exists",
    [companyId]
  );
  const makePrimary = !hasPrimary?.exists;
  const { cols, placeholders, vals } = await insertParts({ company_id: companyId, name, email, phone: phone ?? null, title: title ?? null, is_primary: makePrimary }, { source });
  const contact = await queryOne<Contact>(`insert into contacts (${cols}) values (${placeholders}) returning *`, vals);
  return contact as Contact;
}

export async function listContactsForCompany(companyId: string): Promise<Contact[]> {
  return query<Contact>("select * from contacts where company_id = $1 order by is_primary desc, created_at asc", [companyId]);
}

export async function addContact(
  companyId: string,
  input: { name: string; email: string; phone?: string | null; title?: string | null; makePrimary?: boolean; source?: ContactSource; external_ref?: string | null },
  leadIdForActivity: string | null,
  actorName: string
): Promise<Contact> {
  // Never a second row for the same person at the same company.
  const existing = await findContactByEmail(companyId, input.email);
  if (existing) throw new ContactExistsError(existing);
  const parts = await insertParts(
    { company_id: companyId, name: input.name, email: input.email, phone: input.phone ?? null, title: input.title ?? null, is_primary: Boolean(input.makePrimary) },
    { source: input.source ?? "manual", external_ref: input.external_ref ?? null }
  );
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    if (input.makePrimary) {
      await client.query("update contacts set is_primary = false where company_id = $1", [companyId]);
    }
    const { rows } = await client.query<Contact>(`insert into contacts (${parts.cols}) values (${parts.placeholders}) returning *`, parts.vals);
    if (input.makePrimary) {
      await client.query("update leads set primary_contact_id = $2 where company_id = $1", [companyId, rows[0].id]);
    }
    await client.query("commit");
    if (leadIdForActivity) {
      await recordActivity({
        leadId: leadIdForActivity,
        type: "note",
        body: `Added contact ${input.name}${input.makePrimary ? " as primary contact" : ""}.`,
        actorName,
        metadata: { kind: "contact_added", contact_id: rows[0].id, source: input.source ?? "manual" },
      });
    }
    return rows[0];
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Edit a contact in place.
 *
 * People change roles, emails and numbers, and a wrong address is the quiet
 * reason a deal goes cold — so the record has to be correctable where the work
 * happens rather than by adding a duplicate contact. Promotion to primary runs
 * in the same transaction as the demotion of whoever held it, because the
 * `one_primary_contact_per_company` index will reject the pair otherwise, and
 * the lead's `primary_contact_id` moves with it.
 *
 * What actually changed is written to the timeline field by field. "Updated
 * contact" tells a colleague nothing; "Dana Kim — email, title" tells them
 * whether to re-send the quote.
 */
export async function updateContact(
  contactId: string,
  input: { name: string; email: string; phone?: string | null; title?: string | null; makePrimary?: boolean },
  leadIdForActivity: string,
  actorName: string
): Promise<Contact> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("begin");
    const { rows: before } = await client.query<Contact>("select * from contacts where id = $1 for update", [contactId]);
    const existing = before[0];
    if (!existing) throw new Error("Contact not found");

    if (input.makePrimary && !existing.is_primary) {
      await client.query("update contacts set is_primary = false where company_id = $1", [existing.company_id]);
    }
    const { rows } = await client.query<Contact>(
      `update contacts set name = $2, email = $3, phone = $4, title = $5, is_primary = $6 where id = $1 returning *`,
      [
        contactId,
        input.name,
        input.email,
        input.phone ?? null,
        input.title ?? null,
        // Never silently demote the current primary: clearing the box on the
        // person who holds it would leave the company without one.
        input.makePrimary ? true : existing.is_primary,
      ]
    );
    if (input.makePrimary && !existing.is_primary) {
      await client.query("update leads set primary_contact_id = $2 where company_id = $1", [existing.company_id, contactId]);
    }
    await client.query("commit");

    const changed = [
      existing.name !== input.name && "name",
      existing.email !== input.email && "email",
      (existing.phone ?? null) !== (input.phone ?? null) && "phone",
      (existing.title ?? null) !== (input.title ?? null) && "title",
      input.makePrimary && !existing.is_primary && "made primary contact",
    ].filter(Boolean) as string[];

    if (changed.length) {
      await recordActivity({
        leadId: leadIdForActivity,
        type: "note",
        body: `Updated contact ${input.name} — ${changed.join(", ")}.`,
        actorName,
      });
    }
    return rows[0];
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}


export class ContactExistsError extends Error {
  constructor(readonly existing: Contact) {
    super(`${existing.email} is already a contact on this company.`);
    this.name = "ContactExistsError";
  }
}

/* ----------------------------------------------------------------- import */

export interface UpsertRow {
  companyId: string;
  name: string;
  email: string;
  phone: string | null;
  title: string | null;
  external_ref: string | null;
  /** "create" inserts; "update" fills the existing row's blanks (and corrects name/title when given). */
  mode: "create" | "update";
  existingId?: string | null;
}

export interface UpsertResult {
  created: number;
  updated: number;
  ids: string[];
}

/**
 * Write an import in one transaction. Create rows insert (the first contact
 * on a company becomes primary); update rows only fill fields that are empty
 * or given — an import never blanks a phone number a rep typed by hand.
 */
export async function bulkUpsertContacts(rows: UpsertRow[], source: ContactSource): Promise<UpsertResult> {
  const prov = await hasProvenanceColumns();
  const pool = getPool();
  const client = await pool.connect();
  const result: UpsertResult = { created: 0, updated: 0, ids: [] };
  try {
    await client.query("begin");
    for (const r of rows) {
      if (r.mode === "update" && r.existingId) {
        const { rows: out } = await client.query<Contact>(
          prov
            ? `update contacts set name = coalesce(nullif($2, ''), name), phone = coalesce(nullif($3, ''), phone), title = coalesce(nullif($4, ''), title),
                      source = coalesce(source, $5), external_ref = coalesce(nullif($6, ''), external_ref)
                where id = $1 returning *`
            : `update contacts set name = coalesce(nullif($2, ''), name), phone = coalesce(nullif($3, ''), phone), title = coalesce(nullif($4, ''), title)
                where id = $1 returning *`,
          prov ? [r.existingId, r.name, r.phone, r.title, source, r.external_ref] : [r.existingId, r.name, r.phone, r.title]
        );
        if (out[0]) {
          result.updated += 1;
          result.ids.push(out[0].id);
        }
        continue;
      }
      const { rows: primary } = await client.query<{ exists: boolean }>("select exists(select 1 from contacts where company_id = $1 and is_primary) as exists", [r.companyId]);
      const makePrimary = !primary[0]?.exists;
      const cols = ["company_id", "name", "email", "phone", "title", "is_primary"];
      const vals: unknown[] = [r.companyId, r.name, r.email, r.phone, r.title, makePrimary];
      if (prov) {
        cols.push("source", "external_ref");
        vals.push(source, r.external_ref);
      }
      const { rows: out } = await client.query<Contact>(`insert into contacts (${cols.join(", ")}) values (${vals.map((_, i) => `$${i + 1}`).join(", ")}) returning *`, vals);
      if (makePrimary) await client.query("update leads set primary_contact_id = $2 where company_id = $1 and primary_contact_id is null", [r.companyId, out[0].id]);
      result.created += 1;
      result.ids.push(out[0].id);
    }
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Bring contacts from another company onto this one — a person who moved, or
 * a sister account. Copies, never moves: the other account keeps its record.
 * Skips anyone already here by email.
 */
export async function copyContactsToCompany(targetCompanyId: string, contactIds: string[], leadIdForActivity: string | null, actorName: string): Promise<{ added: Contact[]; skipped: string[] }> {
  if (!contactIds.length) return { added: [], skipped: [] };
  const sources = await query<Contact>("select * from contacts where id = any($1::uuid[])", [contactIds]);
  const added: Contact[] = [];
  const skipped: string[] = [];
  for (const c of sources) {
    if (await findContactByEmail(targetCompanyId, c.email)) {
      skipped.push(c.email);
      continue;
    }
    added.push(await addContact(targetCompanyId, { name: c.name, email: c.email, phone: c.phone, title: c.title, source: "existing_company" }, null, actorName));
  }
  if (added.length && leadIdForActivity) {
    await recordActivity({
      leadId: leadIdForActivity,
      type: "note",
      body: `Added ${added.length} contact${added.length === 1 ? "" : "s"} from an existing company: ${added.map((a) => a.name).join(", ")}.`,
      actorName,
      metadata: { kind: "contacts_copied", contact_ids: added.map((a) => a.id), source: "existing_company" },
    });
  }
  return { added, skipped };
}
