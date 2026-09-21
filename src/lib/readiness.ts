import type { Contact, Lead } from "@/lib/types";

/**
 * Quote Readiness — is there enough on this opportunity to confirm the deal and
 * start pricing it? Derived from the existing lead/contact data, nothing stored.
 * Six checks; a deal is "ready" when all six pass and the stage is Qualified.
 */
export interface ReadinessCheck {
  key: string;
  label: string;
  ok: boolean;
  hint: string;
}

export interface QuoteReadiness {
  checks: ReadinessCheck[];
  passed: number;
  total: number;
  /** all checks pass */
  complete: boolean;
  /** complete AND stage is at least Qualified — the button unlocks here */
  ready: boolean;
  missing: string[];
}

export function computeReadiness(lead: Lead, contacts: Contact[]): QuoteReadiness {
  const q = lead.qualification ?? {};
  const primary = contacts.find((c) => c.id === lead.primary_contact_id) ?? contacts.find((c) => c.is_primary) ?? contacts[0];
  const users = q.number_of_users ?? lead.number_of_users;

  const checks: ReadinessCheck[] = [
    { key: "contact", label: "Primary contact with email", ok: Boolean(primary?.email), hint: "Who receives the quote" },
    { key: "users", label: "Confirmed user count", ok: Boolean(users && users > 0), hint: "Drives licence quantity" },
    { key: "need", label: "Primary need", ok: Boolean(q.primary_need || lead.interest), hint: "Which products to configure" },
    { key: "timeline", label: "Decision timeline", ok: Boolean(q.decision_timeline), hint: "Sets quote validity and urgency" },
    { key: "decision_maker", label: "Decision maker identified", ok: Boolean(q.decision_maker), hint: "Who signs" },
    { key: "budget", label: "Budget range", ok: Boolean(q.budget), hint: "Budget context for Quote Ready" },
  ];
  const passed = checks.filter((c) => c.ok).length;
  const complete = passed === checks.length;
  const stageOk = lead.status === "qualified" || lead.status === "quoted" || lead.status === "won";
  return {
    checks,
    passed,
    total: checks.length,
    complete,
    ready: complete && stageOk,
    missing: checks.filter((c) => !c.ok).map((c) => c.label),
  };
}

/** When the rep last pressed "Continue to Quote Ready" (recorded as an activity), if ever. */
export function quoteReadyAt(activities: { metadata: Record<string, unknown>; occurred_at: string }[]): string | null {
  const hit = activities.find((a) => a.metadata?.kind === "quote_ready");
  return hit ? hit.occurred_at : null;
}
