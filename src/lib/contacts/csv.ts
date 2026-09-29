/**
 * CSV contact import — the pure part. Parsing, header → field mapping and
 * per-row validation run in the browser so the user sees the file read back
 * before anything touches the server. Duplicate detection needs the database
 * and lives in the server action (app/actions/contacts.ts).
 */

export type ContactField = "name" | "first_name" | "last_name" | "email" | "phone" | "company" | "title" | "owner" | "external_ref" | "users" | "interest" | "requirements" | "ignore";

export const CONTACT_FIELD_LABELS: Record<ContactField, string> = {
  name: "Full name",
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
  company: "Company",
  title: "Job title",
  owner: "Owner",
  external_ref: "External id",
  users: "Number of users (lead)",
  interest: "Interested in (lead)",
  requirements: "Requirements (lead)",
  ignore: "Skip this column",
};

/** Header synonyms, lowercased and stripped of punctuation. Longest match wins. */
const SYNONYMS: [ContactField, string[]][] = [
  ["email", ["email", "e mail", "email address", "work email", "business email", "mail", "emailaddress"]],
  ["first_name", ["first name", "firstname", "given name", "first", "fname"]],
  ["last_name", ["last name", "lastname", "surname", "family name", "last", "lname"]],
  ["name", ["name", "full name", "fullname", "contact", "contact name", "person", "lead name", "customer name"]],
  ["phone", ["phone", "phone number", "mobile", "mobile number", "cell", "telephone", "tel", "work phone", "direct"]],
  ["company", ["company", "company name", "organization", "organisation", "account", "account name", "employer", "business", "firm", "org"]],
  ["title", ["title", "job title", "jobtitle", "role", "position", "designation", "job"]],
  ["owner", ["owner", "contact owner", "account owner", "rep", "sales rep", "assigned to", "assigned", "owner name", "salesperson"]],
  ["external_ref", ["id", "contact id", "record id", "hubspot id", "salesforce id", "crm id", "external id", "sfdc id"]],
  ["users", ["users", "number of users", "user count", "seats", "employees", "headcount", "agents", "loan officers", "team size"]],
  ["interest", ["interest", "interested in", "product", "product interest", "solution", "area"]],
  ["requirements", ["requirements", "notes", "needs", "description", "comments", "message", "use case"]],
];

function norm(h: string) {
  return h.toLowerCase().replace(/[_\-./()]/g, " ").replace(/\s+/g, " ").trim();
}

/** Guess a field for every header. Each field is used at most once; the best-scoring header wins it. */
export function suggestMapping(headers: string[]): ContactField[] {
  const scored = headers.map((h, i) => {
    const n = norm(h);
    let best: { field: ContactField; score: number } = { field: "ignore", score: 0 };
    for (const [field, words] of SYNONYMS) {
      for (const w of words) {
        const score = n === w ? 100 + w.length : n.includes(w) ? 50 + w.length : 0;
        if (score > best.score) best = { field, score };
      }
    }
    return { i, ...best };
  });
  const out: ContactField[] = headers.map(() => "ignore");
  const taken = new Set<ContactField>();
  for (const s of [...scored].sort((a, b) => b.score - a.score)) {
    if (s.field === "ignore" || taken.has(s.field)) continue;
    out[s.i] = s.field;
    taken.add(s.field);
  }
  return out;
}

/** RFC 4180-style parser: quoted fields, doubled quotes, embedded commas and newlines, CRLF. */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const src = text.replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) rows.push(row);
  }
  const headers = (rows.shift() ?? []).map((h) => h.trim());
  return { headers, rows };
}

export interface ImportRow {
  /** 1-based line in the file (header is line 1). */
  line: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  title: string | null;
  owner: string | null;
  external_ref: string | null;
  /** Lead fields, when the sheet carries them. */
  users: number | null;
  interest: string | null;
  requirements: string | null;
  /** Problems the row cannot be imported with. */
  errors: string[];
  /** Things worth a look that do not block the row. */
  warnings: string[];
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const FREE_MAIL = new Set(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "icloud.com", "aol.com", "proton.me", "protonmail.com"]);

export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const d = email.slice(at + 1).toLowerCase().trim();
  return d && !FREE_MAIL.has(d) ? d : null;
}

/** Apply the mapping and validate each row. Nothing here touches the database. */
export function buildRows(rows: string[][], mapping: ContactField[]): ImportRow[] {
  const idx = (f: ContactField) => mapping.indexOf(f);
  const get = (r: string[], f: ContactField) => {
    const i = idx(f);
    return i >= 0 ? (r[i] ?? "").trim() : "";
  };
  return rows.map((r, n) => {
    const first = get(r, "first_name");
    const last = get(r, "last_name");
    let name = get(r, "name") || [first, last].filter(Boolean).join(" ");
    const email = get(r, "email").toLowerCase();
    const phone = get(r, "phone") || null;
    const company = get(r, "company") || null;
    const title = get(r, "title") || null;
    const owner = get(r, "owner") || null;
    const external_ref = get(r, "external_ref") || null;
    const usersRaw = get(r, "users").replace(/[,\s]/g, "");
    const users = usersRaw && /^\d+$/.test(usersRaw) ? Number(usersRaw) : null;
    const interest = get(r, "interest") || null;
    const requirements = get(r, "requirements") || null;
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!email) errors.push("Missing email");
    else if (!EMAIL_RE.test(email)) errors.push(`Invalid email “${email}”`);
    if (!name && email && EMAIL_RE.test(email)) {
      name = email.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      warnings.push("No name in the file — using the email address");
    }
    if (!name && !errors.length) errors.push("Missing name");
    if (email && EMAIL_RE.test(email) && !emailDomain(email) && !company) warnings.push("Personal email and no company — the contact will need a company");
    if (phone && !/^[+(]?[\d][\d\s().+-]{5,}$/.test(phone)) warnings.push(`Phone “${phone}” does not look like a number`);
    if (usersRaw && users === null) warnings.push(`Users “${get(r, "users")}” is not a number`);
    return { line: n + 2, name, email, phone, company, title, owner, external_ref, users, interest, requirements, errors, warnings };
  });
}

/** Rows that repeat an email inside the same file. Returns the line numbers of the later occurrences. */
export function duplicatesWithinFile(rows: ImportRow[]): Map<number, number> {
  const seen = new Map<string, number>();
  const dupes = new Map<number, number>();
  for (const r of rows) {
    if (!r.email) continue;
    const first = seen.get(r.email);
    if (first !== undefined) dupes.set(r.line, first);
    else seen.set(r.email, r.line);
  }
  return dupes;
}

/** A small sample file the Import dialog offers, so the flow can be tried without hunting for a CSV. */
export const SAMPLE_CSV = `First Name,Last Name,Work Email,Phone,Company,Job Title,Owner,Number of Users,Interested In,Notes
Dana,Whitfield,dana.whitfield@planethomelending.example,+1 (415) 555-0100,Planet Home Lending,VP Customer Experience,Sandhya,200,Reputation Management,Renewal — wants advanced analytics
Marcus,Bell,marcus.bell@planethomelending.example,+1 (415) 555-0101,Planet Home Lending,Director of Operations,Sandhya,,,
Elena,Ruiz,elena.ruiz@meridianhomeloans.example,,Meridian Home Loans,COO,Marcus Lee,1200,Experience Management Platform,
Priya,Nair,priya.nair@northstarrealty.example,+1 (212) 555-0199,Northstar Realty,Head of Marketing,,85,Online Listings,Three branches; listings first then reviews
Sam,Okoro,sam.okoro,555-0102,Okoro Dental,Practice Manager,,12,Reviews Monitoring,
,,jane@gmail.com,,,,,,,
Elena,Ruiz,elena.ruiz@meridianhomeloans.example,+1 (303) 555-0177,Meridian Home Loans,Chief Operating Officer,Marcus Lee,,,
`;
