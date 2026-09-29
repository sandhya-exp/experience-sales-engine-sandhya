"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { listTeam } from "@/lib/repo/users";
import { assignLeadOwner, getLeadById } from "@/lib/repo/leads";
import { recordActivity } from "@/lib/repo/activities";
import { createCompany, findCompanyByDomain, findCompanyByName, searchCompanies, type CompanySearchRow } from "@/lib/repo/companies";
import {
  addContact,
  bulkUpsertContacts,
  ContactExistsError,
  copyContactsToCompany,
  findContactsByEmails,
  listContactsForCompany,
  type UpsertRow,
} from "@/lib/repo/contacts";
import { buildRows, duplicatesWithinFile, emailDomain, type ContactField, type ImportRow } from "@/lib/contacts/csv";
import { externalSourceStatus, fetchExternalContacts, type ExternalSourceStatus } from "@/lib/contacts/external";
import type { ContactSource } from "@/lib/contacts/source";
import type { Contact } from "@/lib/types";

/**
 * Contact acquisition — four ways in, one set of rules:
 *   - a person is matched by email (case-insensitive) within a company;
 *   - a company is matched by email domain first, then by exact name;
 *   - nothing is written twice, and an import never blanks a field a rep typed.
 */

function revalidate(leadId?: string | null) {
  if (leadId) revalidatePath(`/leads/${leadId}`);
  revalidatePath("/companies");
  revalidatePath("/pipeline");
}

export interface ActionResult {
  ok: boolean;
  detail: string;
}

/* ------------------------------------------------------------- 1. create */

export interface CreateContactInput {
  name: string;
  email: string;
  phone?: string | null;
  title?: string | null;
  /** Fixed on the deal workspace; chosen (or typed as a new company) elsewhere. */
  companyId?: string | null;
  newCompanyName?: string | null;
  makePrimary?: boolean;
  /** Assign the company's open opportunity to this rep, when it has none. */
  ownerUserId?: string | null;
  /** The opportunity to write the timeline note on, when known. */
  leadId?: string | null;
}

export async function createContactAction(input: CreateContactInput): Promise<ActionResult & { contact?: Contact }> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, detail: "Sign in first." };
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name) return { ok: false, detail: "A contact needs a name." };
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { ok: false, detail: "Enter a valid email address." };

  let companyId = input.companyId ?? null;
  if (!companyId) {
    // Resolve the company the way an inquiry does: domain first, then name, then create.
    const domain = emailDomain(email);
    const byDomain = domain ? await findCompanyByDomain(domain) : null;
    const byName = !byDomain && input.newCompanyName ? await findCompanyByName(input.newCompanyName) : null;
    const existing = byDomain ?? byName;
    if (existing) companyId = existing.id;
    else {
      const companyName = input.newCompanyName?.trim() || (domain ? domain.split(".")[0].replace(/\b\w/g, (c) => c.toUpperCase()) : "");
      if (!companyName) return { ok: false, detail: "Enter a company for this contact — the email is a personal address, so it cannot be inferred." };
      companyId = (await createCompany(companyName, domain)).id;
    }
  }

  try {
    const contact = await addContact(companyId, { name, email, phone: input.phone?.trim() || null, title: input.title?.trim() || null, makePrimary: input.makePrimary, source: "manual" }, input.leadId ?? null, user.name);
    if (input.ownerUserId && input.leadId) {
      const lead = await getLeadById(input.leadId);
      if (lead && !lead.owner_user_id) await assignLeadOwner(input.leadId, input.ownerUserId, user.name, "Assigned when the contact was added");
    }
    revalidate(input.leadId);
    return { ok: true, detail: `${contact.name} added.`, contact };
  } catch (err) {
    if (err instanceof ContactExistsError) return { ok: false, detail: `${err.existing.name} (${err.existing.email}) is already a contact on this company.` };
    console.error("Create contact failed:", err);
    return { ok: false, detail: "The contact could not be saved." };
  }
}

/* --------------------------------------------------------- 2. CSV import */

export type RowStatus = "create" | "update" | "skip" | "duplicate_in_file" | "invalid";

export interface PlannedRow extends ImportRow {
  status: RowStatus;
  /** The company this row will join, or the one it will create. */
  company: string | null;
  companyId: string | null;
  companyAction: "existing" | "create" | null;
  /** Why the company was matched: the email domain or the name. */
  companyMatch: "domain" | "name" | null;
  /** For update/skip: the contact already on file. */
  existing?: { id: string; name: string; email: string; company_name: string; phone: string | null; title: string | null } | null;
  /** What an update would change. */
  changes?: string[];
  /** Line of the first occurrence, for duplicate_in_file. */
  duplicateOf?: number | null;
  /** Default include state the preview starts with. */
  include: boolean;
}

export interface ImportPlan {
  rows: PlannedRow[];
  summary: {
    total: number;
    ready: number;
    updates: number;
    skips: number;
    attention: number;
    duplicates: number;
    newCompanies: number;
    ownersUnmatched: number;
  };
  ownerMap: Record<string, string | null>;
}

/**
 * Validate, resolve companies, and detect duplicates for a parsed file.
 * Nothing is written. The plan is what the preview shows and what the
 * confirm step sends back (with the user's include/skip choices).
 */
export async function planCsvImportAction(rows: string[][], mapping: ContactField[], scope?: { companyId?: string | null }): Promise<ImportPlan> {
  const built = buildRows(rows, mapping);
  const inFile = duplicatesWithinFile(built);
  const valid = built.filter((r) => r.errors.length === 0);
  const existing = await findContactsByEmails(valid.map((r) => r.email));
  const byEmail = new Map(existing.map((c) => [c.email.toLowerCase(), c]));
  const team = await listTeam();
  const ownerMap: Record<string, string | null> = {};
  const findOwner = (label: string | null) => {
    if (!label) return null;
    if (label in ownerMap) return ownerMap[label];
    const l = label.trim().toLowerCase();
    const hit = team.find((m) => m.name.toLowerCase() === l || m.email.toLowerCase() === l || m.name.toLowerCase().split(" ")[0] === l);
    ownerMap[label] = hit?.id ?? null;
    return ownerMap[label];
  };
  const companyCache = new Map<string, { id: string | null; name: string; match: "domain" | "name" | null }>();

  const planned: PlannedRow[] = [];
  let newCompanies = 0;
  const newCompanyKeys = new Set<string>();
  for (const r of built) {
    findOwner(r.owner);
    const base: PlannedRow = { ...r, status: "invalid", company: r.company, companyId: null, companyAction: null, companyMatch: null, include: false };
    if (r.errors.length) {
      planned.push(base);
      continue;
    }
    if (inFile.has(r.line)) {
      planned.push({ ...base, status: "duplicate_in_file", duplicateOf: inFile.get(r.line) });
      continue;
    }
    const match = byEmail.get(r.email);
    if (match) {
      const changes = [
        r.name && r.name !== match.name ? "name" : null,
        r.phone && r.phone !== match.phone ? "phone" : null,
        r.title && r.title !== match.title ? "title" : null,
      ].filter(Boolean) as string[];
      planned.push({
        ...base,
        status: changes.length ? "update" : "skip",
        company: match.company_name,
        companyId: match.company_id,
        companyAction: "existing",
        companyMatch: "domain",
        existing: { id: match.id, name: match.name, email: match.email, company_name: match.company_name, phone: match.phone, title: match.title },
        changes,
        include: changes.length > 0,
      });
      continue;
    }
    // New person: which company?
    let company: { id: string | null; name: string; match: "domain" | "name" | null };
    if (scope?.companyId) company = { id: scope.companyId, name: r.company ?? "", match: null };
    else {
      const domain = emailDomain(r.email);
      const key = domain ?? `name:${(r.company ?? "").toLowerCase()}`;
      const cached = companyCache.get(key);
      if (cached) company = cached;
      else {
        const byDomain = domain ? await findCompanyByDomain(domain) : null;
        const byName = !byDomain && r.company ? await findCompanyByName(r.company) : null;
        const found = byDomain ?? byName;
        company = found ? { id: found.id, name: found.name, match: byDomain ? "domain" : "name" } : { id: null, name: r.company ?? (domain ? domain.split(".")[0].replace(/\b\w/g, (c) => c.toUpperCase()) : ""), match: null };
        companyCache.set(key, company);
      }
      if (!company.id && !company.name) {
        planned.push({ ...base, errors: [...r.errors, "Personal email with no company"], status: "invalid" });
        continue;
      }
      if (!company.id && !newCompanyKeys.has(key)) {
        newCompanyKeys.add(key);
        newCompanies += 1;
      }
    }
    planned.push({ ...base, status: "create", company: company.name || r.company, companyId: company.id, companyAction: company.id ? "existing" : "create", companyMatch: company.match, include: true });
  }

  const summary = {
    total: built.length,
    ready: planned.filter((r) => r.status === "create").length,
    updates: planned.filter((r) => r.status === "update").length,
    skips: planned.filter((r) => r.status === "skip").length,
    attention: planned.filter((r) => r.status === "invalid" || (r.status === "create" && r.warnings.length > 0)).length,
    duplicates: planned.filter((r) => r.status === "duplicate_in_file" || r.status === "update" || r.status === "skip").length,
    newCompanies,
    ownersUnmatched: Object.values(ownerMap).filter((v) => v === null).length,
  };
  return { rows: planned, summary, ownerMap };
}

export interface ImportResult extends ActionResult {
  created: number;
  updated: number;
  companiesCreated: number;
  skipped: number;
}

/** Write the rows the user kept. Companies that need creating are created once per domain/name. */
export async function commitCsvImportAction(rows: PlannedRow[], source: ContactSource, leadId?: string | null): Promise<ImportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, detail: "Sign in first.", created: 0, updated: 0, companiesCreated: 0, skipped: 0 };
  const kept = rows.filter((r) => r.include && (r.status === "create" || r.status === "update"));
  const skipped = rows.length - kept.length;
  const companyIds = new Map<string, string>();
  let companiesCreated = 0;
  const upserts: UpsertRow[] = [];
  for (const r of kept) {
    let companyId = r.companyId;
    if (!companyId) {
      const domain = emailDomain(r.email);
      const key = domain ?? `name:${(r.company ?? "").toLowerCase()}`;
      companyId = companyIds.get(key) ?? null;
      if (!companyId) {
        // Re-check at write time: the file may have been planned a while ago.
        const found = (domain ? await findCompanyByDomain(domain) : null) ?? (r.company ? await findCompanyByName(r.company) : null);
        if (found) companyId = found.id;
        else {
          companyId = (await createCompany(r.company ?? domain ?? "Unknown company", domain)).id;
          companiesCreated += 1;
        }
        companyIds.set(key, companyId);
      }
    }
    upserts.push({ companyId, name: r.name, email: r.email, phone: r.phone, title: r.title, external_ref: r.external_ref, mode: r.status === "update" ? "update" : "create", existingId: r.existing?.id ?? null });
  }
  try {
    const result = await bulkUpsertContacts(upserts, source);
    if (leadId) {
      await recordActivity({
        leadId,
        type: "note",
        body: `Imported ${result.created} contact${result.created === 1 ? "" : "s"} from ${source === "external_crm" ? "an external CRM" : "CSV"}${result.updated ? `, updated ${result.updated}` : ""}.`,
        actorName: user.name,
        metadata: { kind: "contacts_imported", source, created: result.created, updated: result.updated, contact_ids: result.ids },
      });
    }
    revalidate(leadId);
    return { ok: true, detail: `${result.created} added, ${result.updated} updated${companiesCreated ? `, ${companiesCreated} new compan${companiesCreated === 1 ? "y" : "ies"}` : ""}.`, created: result.created, updated: result.updated, companiesCreated, skipped };
  } catch (err) {
    console.error("Contact import failed:", err);
    return { ok: false, detail: "The import could not be written; nothing was changed.", created: 0, updated: 0, companiesCreated, skipped };
  }
}

/* ------------------------------------------ 3. add from existing company */

export async function searchCompaniesAction(q: string): Promise<CompanySearchRow[]> {
  if (!(await getCurrentUser())) return [];
  return searchCompanies(q, 8);
}

export async function listCompanyContactsAction(companyId: string): Promise<Contact[]> {
  if (!(await getCurrentUser())) return [];
  return listContactsForCompany(companyId);
}

export async function addContactsFromCompanyAction(targetCompanyId: string, contactIds: string[], leadId?: string | null): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, detail: "Sign in first." };
  const { added, skipped } = await copyContactsToCompany(targetCompanyId, contactIds, leadId ?? null, user.name);
  revalidate(leadId);
  return {
    ok: true,
    detail: `${added.length} contact${added.length === 1 ? "" : "s"} added${skipped.length ? `; ${skipped.length} already here (${skipped.join(", ")})` : ""}.`,
  };
}

/* ------------------------------------------------------ 4. external CRM */

export async function externalSourceStatusAction(): Promise<ExternalSourceStatus> {
  return externalSourceStatus();
}

/** Pull from the configured provider into the same plan the CSV flow uses. */
export async function planExternalImportAction(scope?: { companyId?: string | null }): Promise<ImportPlan | { error: string }> {
  if (!(await getCurrentUser())) return { error: "Sign in first." };
  try {
    const contacts = await fetchExternalContacts(200);
    const rows = contacts.map((c) => [c.external_ref, c.name, c.email, c.phone ?? "", c.company ?? "", c.title ?? "", c.owner ?? ""]);
    return planCsvImportAction(rows, ["external_ref", "name", "email", "phone", "company", "title", "owner"], scope);
  } catch (err) {
    return { error: err instanceof Error ? err.message : "The external source could not be read." };
  }
}
