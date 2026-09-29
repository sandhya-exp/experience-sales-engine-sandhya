/**
 * Contact provenance. Client-safe: dialogs and tables label rows with it.
 *
 * A contact's `source` answers "how did this person get into our system?" —
 * which is what a rep needs when an email bounces or a name looks wrong.
 */
export type ContactSource = "talk_to_sales" | "manual" | "csv_import" | "existing_company" | "external_crm" | "api" | "new_lead";

export const CONTACT_SOURCE_LABELS: Record<ContactSource, string> = {
  talk_to_sales: "Created from Talk to Sales",
  new_lead: "Added via New Lead",
  manual: "Added manually",
  csv_import: "Imported from CSV",
  existing_company: "Added from existing company",
  external_crm: "External CRM",
  api: "Created via API",
};

export function contactSourceLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  return (CONTACT_SOURCE_LABELS as Record<string, string>)[source] ?? source;
}

/** The provenance the inbound channel label maps to (inquiries.ts passes "Talk to Sales form", "API (partner)", …). */
export function sourceForChannel(channel: string): ContactSource {
  const c = channel.toLowerCase();
  if (c.includes("talk to sales")) return "talk_to_sales";
  if (c.startsWith("api")) return "api";
  if (c.includes("new lead")) return "new_lead";
  return "manual";
}
