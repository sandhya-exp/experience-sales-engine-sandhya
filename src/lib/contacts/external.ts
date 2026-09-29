/**
 * External contact sources — the integration boundary.
 *
 * The Contacts menu offers "External Contacts". This module is what it asks:
 * is a provider configured, and if so, fetch a page of contacts from it. It
 * is deliberately honest: with nothing configured it says so, and the UI
 * shows how to configure one instead of pretending to sync.
 *
 * To add a provider: implement `ExternalContactProvider`, register it in
 * `PROVIDERS`, and set CONTACT_SOURCE_PROVIDER=<key> plus that provider's
 * credentials in the environment. Fetched rows go through the same
 * validation → duplicate detection → preview → confirm flow as a CSV, so a
 * provider never writes to the database directly.
 */
export interface ExternalContact {
  external_ref: string;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  title: string | null;
  owner: string | null;
}

export interface ExternalContactProvider {
  key: string;
  name: string;
  /** Environment variables the provider needs, for the setup panel. */
  requiredEnv: string[];
  configured(): boolean;
  /** Fetch up to `limit` contacts, most recently updated first. */
  fetchContacts(limit: number): Promise<ExternalContact[]>;
}

/** Registered providers. Empty until an integration is implemented — see the module note. */
const PROVIDERS: Record<string, ExternalContactProvider> = {};

export interface ExternalSourceStatus {
  configured: boolean;
  provider: { key: string; name: string } | null;
  /** The key that was requested but is not implemented / not configured. */
  requested: string | null;
  missingEnv: string[];
  available: { key: string; name: string; requiredEnv: string[] }[];
}

export function externalSourceStatus(): ExternalSourceStatus {
  const requested = process.env.CONTACT_SOURCE_PROVIDER?.trim() || null;
  const provider = requested ? PROVIDERS[requested] : undefined;
  const available = Object.values(PROVIDERS).map((p) => ({ key: p.key, name: p.name, requiredEnv: p.requiredEnv }));
  if (!provider) return { configured: false, provider: null, requested, missingEnv: [], available };
  const missingEnv = provider.requiredEnv.filter((k) => !process.env[k]?.trim());
  return { configured: missingEnv.length === 0 && provider.configured(), provider: { key: provider.key, name: provider.name }, requested, missingEnv, available };
}

export async function fetchExternalContacts(limit = 200): Promise<ExternalContact[]> {
  const requested = process.env.CONTACT_SOURCE_PROVIDER?.trim();
  const provider = requested ? PROVIDERS[requested] : undefined;
  if (!provider || !provider.configured()) throw new Error("No external contact source is configured.");
  return provider.fetchContacts(limit);
}
