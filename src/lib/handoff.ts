import { computeReadiness } from "@/lib/readiness";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";
import { DOWNSTREAM } from "@/lib/modules";
import { getWorkspaceData } from "@/lib/repo/workspace";
import type { Activity, AiDealBrief, Company, Lead } from "@/lib/types";

/**
 * The Quote Ready handoff: the single integration boundary between the
 * Lead & Deal Workspace (this app) and the downstream Quote → Contract →
 * E-signature → Renewal workspace.
 *
 * Two delivery paths, so neither side blocks the other:
 *   push  – POST the payload to QUOTE_HANDOFF_ENDPOINT on the contract module.
 *   pull  – the contract module GETs /api/handoff/{leadId} from this app.
 * Both return the same QuoteHandoffPayload (see docs/QUOTE_HANDOFF.md).
 */

export const HANDOFF_SCHEMA_VERSION = "2.0";
export const HANDOFF_SOURCE = "lead-deal-workspace";

/**
 * What the contract module receives — and nothing else. Every value appears once.
 * (v1.x sent the same facts two or three times: deal.qualification AND
 * quote_context.budget/timeline/…, account AND quote_context.customer,
 * contacts AND quote_context.primary_contact, ai_brief.summary AND
 * customer_need, readiness.missing AND ai_brief.missing_info. v2 collapses
 * those into one home each — see docs/QUOTE_HANDOFF.md for the mapping.)
 */
export interface QuoteHandoffPayload {
  schema_version: typeof HANDOFF_SCHEMA_VERSION;
  source: typeof HANDOFF_SOURCE;
  /** `resend` is true when this opportunity was handed off before — upsert, never create a second one. */
  handoff: { requested_at: string; requested_by: string; resend: boolean };

  /** The opportunity itself. `id` is the lead id in this workspace. */
  opportunity: {
    id: string;
    stage: Lead["status"];
    owner: string;
    created_at: string;
    qualified_at: string | null;
    url: string;
  };

  /** The customer. `key` is stable across both apps — upsert on it, never create a second account. */
  customer: {
    key: string;
    id: string;
    name: string;
    domain: string | null;
    industry: string | null;
  };

  /** What they need, in the customer's words and structured. */
  need: {
    summary: string | null;
    primary_need: string | null;
    requirements: string | null;
    additional_info: string | null;
    integrations: string[];
  };

  /** How big: licence quantity and footprint. */
  sizing: {
    users: number | null;
    locations: string | null;
  };

  /** What sales has established (null = not yet confirmed) and what is still open. */
  qualification: {
    status: Lead["qualification_status"];
    budget: string | null;
    decision_timeline: string | null;
    decision_maker: string | null;
    current_solution: string | null;
    missing: string[];
  };

  contacts: Array<{
    name: string;
    email: string | null;
    phone: string | null;
    title: string | null;
    is_primary: boolean;
  }>;

  /** Recent human touchpoints only (calls, emails, messages, notes) — no system events. */
  activity: Array<{ type: Activity["type"]; body: string | null; actor: string; occurred_at: string }>;

  /** The one AI-derived thing the contract module uses: commercial implications of the requirements. */
  insights: string[];

  /** Pull endpoint for the same payload. */
  links: { handoff_api_url: string };
}

export function accountKeyFor(company: Company): string {
  return company.domain ?? company.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

const HUMAN_ACTIVITY: Activity["type"][] = ["call", "email", "message", "note"];

export async function buildHandoffPayload(
  leadId: string,
  requestedBy: string,
  appOrigin: string
): Promise<QuoteHandoffPayload | null> {
  const data = await getWorkspaceData(leadId);
  if (!data) return null;
  const { lead, company, contacts, activities, brief, ownerName } = data;
  const q = lead.qualification ?? {};
  const intel = intelligenceOf(brief);
  const readiness = computeReadiness(lead, contacts);
  const qualifiedAt =
    activities.find((a) => a.type === "status_change" && /to qualified\.?$/i.test(a.body ?? ""))?.occurred_at ?? null;

  return {
    schema_version: HANDOFF_SCHEMA_VERSION,
    source: HANDOFF_SOURCE,
    handoff: { requested_at: new Date().toISOString(), requested_by: requestedBy, resend: Boolean(lead.quote_requested_at) },
    opportunity: {
      id: lead.id,
      stage: lead.status,
      owner: ownerName,
      created_at: lead.created_at,
      qualified_at: qualifiedAt,
      url: `${appOrigin}/leads/${lead.id}`,
    },
    customer: {
      key: accountKeyFor(company),
      id: company.id,
      name: company.name,
      domain: company.domain,
      industry: company.industry,
    },
    need: {
      summary: intel?.customer_need ?? null,
      primary_need: q.primary_need ?? lead.interest ?? null,
      requirements: lead.requirements,
      additional_info: lead.additional_info,
      integrations: intel?.quote_context.integrations ?? [],
    },
    sizing: {
      users: q.number_of_users ?? lead.number_of_users ?? null,
      locations: intel?.quote_context.deployment ?? null,
    },
    qualification: {
      status: lead.qualification_status,
      budget: q.budget ?? null,
      decision_timeline: q.decision_timeline ?? null,
      decision_maker: q.decision_maker ?? null,
      current_solution: q.current_solution ?? null,
      missing: readiness.missing,
    },
    contacts: contacts.map((c) => ({ name: c.name, email: c.email, phone: c.phone, title: c.title, is_primary: c.id === lead.primary_contact_id || c.is_primary })),
    activity: activities
      .filter((a) => HUMAN_ACTIVITY.includes(a.type) && a.metadata?.kind !== "quote_ready" && a.metadata?.kind !== "assignment")
      .slice(0, 5)
      .map((a) => ({ type: a.type, body: a.body, actor: a.actor_name ?? "System", occurred_at: a.occurred_at })),
    insights: intel?.quote_implications ?? [],
    links: { handoff_api_url: `${appOrigin}/api/handoff/${lead.id}` },
  };
}

function intelligenceOf(b: AiDealBrief | null): OpportunityIntelligence | null {
  return b && b.intelligence && "quote_context" in b.intelligence ? (b.intelligence as OpportunityIntelligence) : null;
}

/* ------------------------------------------------------------------ */
/* Where the contract module lives and how we reach it                 */
/* ------------------------------------------------------------------ */

export interface QuoteWorkspaceConfig {
  /** Base URL of the contract module, e.g. http://127.0.0.1:8001 */
  baseUrl: string | null;
  /** POST target for the push path. Defaults to {baseUrl}/api/handoffs */
  endpoint: string | null;
  /**
   * Where to send the user afterwards. Supports {accountKey}, {leadId}.
   * Defaults to {baseUrl}/?lead_id={leadId}&customer_id={accountKey} — the Quote Ready
   * module (modules/guided-selling) opens that handoff, or its Customer 360 once accepted.
   */
  accountUrlTemplate: string | null;
  /** Optional shared secret sent as X-Sales-Engine-Key on the push. */
  apiKey: string | null;
}

export function getQuoteWorkspaceConfig(): QuoteWorkspaceConfig {
  const baseUrl = trimSlash(process.env.QUOTE_WORKSPACE_URL) ?? null;
  return {
    baseUrl,
    endpoint: process.env.QUOTE_HANDOFF_ENDPOINT || (baseUrl ? `${baseUrl}/api/handoffs` : null),
    accountUrlTemplate:
      process.env.QUOTE_ACCOUNT_URL_TEMPLATE ||
      (baseUrl ? `${baseUrl}/?lead_id={leadId}&customer_id={accountKey}` : null),
    apiKey: process.env.HANDOFF_API_KEY || null,
  };
}

export function quoteWorkspaceUrlFor(accountKey: string, leadId: string): string | null {
  const { accountUrlTemplate } = getQuoteWorkspaceConfig();
  if (!accountUrlTemplate) return null;
  return accountUrlTemplate
    .replace("{accountKey}", encodeURIComponent(accountKey))
    .replace("{leadId}", encodeURIComponent(leadId));
}

export interface DeliveryResult {
  status: "delivered" | "pending" | "not_configured";
  /** Where to send the user. */
  url: string | null;
  detail: string;
}

/**
 * Push the payload to the contract module. Never throws: an unreachable or
 * not-yet-implemented endpoint downgrades to "pending" (the quote side can
 * pull from /api/handoff/{leadId}) and we still navigate the user across.
 */
export async function deliverHandoff(payload: QuoteHandoffPayload): Promise<DeliveryResult> {
  const cfg = getQuoteWorkspaceConfig();
  const fallbackUrl = quoteWorkspaceUrlFor(payload.customer.key, payload.opportunity.id);

  if (!cfg.endpoint) {
    return { status: "not_configured", url: fallbackUrl, detail: "QUOTE_WORKSPACE_URL is not set." };
  }

  try {
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cfg.apiKey ? { "x-sales-engine-key": cfg.apiKey } : {}),
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
      cache: "no-store",
    });
    if (!res.ok) {
      return { status: "pending", url: fallbackUrl, detail: `${DOWNSTREAM.partner} responded ${res.status}.` };
    }
    // The quote side may tell us exactly where the account now lives.
    const body = (await res.json().catch(() => ({}))) as { account_url?: string; redirect_url?: string };
    const url = body.account_url || body.redirect_url || fallbackUrl;
    return { status: "delivered", url, detail: `Quote context delivered to ${DOWNSTREAM.partner}.` };
  } catch (err) {
    return {
      status: "pending",
      url: fallbackUrl,
      detail: `${DOWNSTREAM.partner} not reachable (${err instanceof Error ? err.message : "error"}); it will pull the context on open.`,
    };
  }
}

function trimSlash(v: string | undefined) {
  return v ? v.replace(/\/+$/, "") : undefined;
}
