import { computeReadiness } from "@/lib/readiness";
import type { OpportunityIntelligence } from "@/lib/ai/intelligence";
import { getWorkspaceData } from "@/lib/repo/workspace";
import { activeQuote, effectiveStatus, listQuotesForLead } from "@/lib/repo/quotes";
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

  /**
   * The active quote, when one exists — the version the customer is looking
   * at or accepted, with its line items and validity. Null when sales handed
   * over without quoting here.
   */
  quote: {
    version: number;
    status: string;
    currency: string;
    total: number;
    discount_pct: number;
    valid_until: string;
    terms: string | null;
    line_items: { description: string; quantity: number; unit_price: number; discount_pct: number }[];
  } | null;

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
  const quote = activeQuote(await listQuotesForLead(leadId));
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
    quote: quote
      ? {
          version: quote.meta.version,
          status: effectiveStatus(quote.meta),
          currency: quote.meta.currency,
          total: quote.meta.total,
          discount_pct: quote.meta.discount_pct,
          valid_until: quote.meta.valid_until,
          terms: quote.meta.terms,
          line_items: quote.meta.line_items,
        }
      : null,
    links: { handoff_api_url: `${appOrigin}/api/handoff/${lead.id}` },
  };
}

function intelligenceOf(b: AiDealBrief | null): OpportunityIntelligence | null {
  return b && b.intelligence && "quote_context" in b.intelligence ? (b.intelligence as OpportunityIntelligence) : null;
}

/* ------------------------------------------------------------------ */
/* Recording the handoff                                              */
/* ------------------------------------------------------------------ */

export interface DeliveryResult {
  status: "recorded";
  /** Where to send the user afterwards — the opportunity's own timeline. */
  url: string | null;
  detail: string;
}

/**
 * The handoff, now that contracting is a separate application.
 *
 * This workspace owns the lifecycle up to Ready to Contract: it assembles the
 * quote context from the opportunity, marks the stage, and records what was
 * handed over on the timeline. It no longer pushes to a downstream service —
 * whoever builds contracting reads the same context from
 * GET /api/handoff/{leadId} (docs/QUOTE_HANDOFF.md), which is the one published
 * contract and needs nothing running here.
 */
export async function deliverHandoff(payload: QuoteHandoffPayload): Promise<DeliveryResult> {
  return {
    status: "recorded",
    url: `/leads/${payload.opportunity.id}?tab=activity`,
    detail: `Quote context recorded: ${payload.contacts.length} contact${payload.contacts.length === 1 ? "" : "s"}, qualification and ${payload.insights.length} insight${payload.insights.length === 1 ? "" : "s"}.`,
  };
}
