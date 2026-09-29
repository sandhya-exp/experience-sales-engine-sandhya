import { NextResponse } from "next/server";
import { findLeadByContactEmail } from "@/lib/repo/contacts";
import { getLeadContextOrThrow } from "@/lib/ai/service";
import { getLatestBrief } from "@/lib/repo/aiBriefs";
import { hasIntelligence } from "@/lib/ai/briefGuards";
import { extractFromReply } from "@/lib/ai/reply";
import { recordInboundReply, type InboundReplyMeta } from "@/lib/repo/inboundReply";
import { primaryContact } from "@/lib/ai/actions";
import { scheduleRefresh } from "@/lib/ai/background";
import { revalidatePath } from "next/cache";

/**
 * POST /api/webhooks/inbound-email
 *
 * The automatic half of the reply loop. A salesperson can already paste a
 * customer's reply into the workspace (`customerReplyAction`); this is the
 * same reading applied to a reply that arrives on its own, from whatever
 * inbound-email provider is wired up outside this app (a forwarding rule, an
 * email-parsing service, a provider's inbound webhook — none is connected
 * yet, so the payload contract below is deliberately generic rather than
 * tied to one vendor's shape, the same honesty `lib/email/provider.ts`
 * already practices for outbound mail).
 *
 * Authorised the same way `/api/inquiries` and `/api/handoff` are: a shared
 * secret in a header, because this is always a server-to-server call with no
 * browser session to check.
 *
 *   Headers:  Content-Type: application/json
 *             X-Inbound-Email-Key: <INBOUND_EMAIL_WEBHOOK_SECRET>
 *   Body:     { from: string, text: string, subject?: string, receivedAt?: string }
 *   Reply:    201 { leadId, activityId, factsFound }
 *
 * What this does NOT do: apply anything to the opportunity. Extraction is
 * identical to a manual reply (`extractFromReply` — the same grounded,
 * quote-or-drop reading), but nothing here has a human confirming the text
 * is real, so every fact lands as a pending suggestion (`confirmed_indices:
 * []`) — a salesperson confirms what to keep from the AI tab, exactly like a
 * processed call recap. The one thing that does happen automatically is the
 * next recommended action: `refreshOpportunity` runs so the agent's summary
 * and next-step reflect that the customer wrote back.
 */
export async function POST(req: Request) {
  const key = process.env.INBOUND_EMAIL_WEBHOOK_SECRET;
  if (!key || req.headers.get("x-inbound-email-key") !== key) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401, headers: cors() });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers: cors() });
  }

  const o = (body ?? {}) as Record<string, unknown>;
  const from = typeof o.from === "string" ? o.from.trim() : "";
  const text = typeof o.text === "string" ? o.text.trim() : "";
  const subject = typeof o.subject === "string" && o.subject.trim() ? o.subject.trim() : null;
  if (!from || !text) {
    return NextResponse.json({ error: "validation", detail: "\"from\" and \"text\" are required." }, { status: 422, headers: cors() });
  }
  if (text.length > 20_000) {
    return NextResponse.json({ error: "validation", detail: "That message is too long." }, { status: 422, headers: cors() });
  }

  const match = await findLeadByContactEmail(from);
  if (!match) {
    // Nothing to attach this to. A 404 rather than a 500: the caller (whatever
    // forwards inbound mail) should not retry this — the sender isn't a known
    // contact — but the request itself was well-formed.
    return NextResponse.json({ error: "no matching lead for that sender" }, { status: 404, headers: cors() });
  }

  const ctx = await getLeadContextOrThrow(match.leadId);
  const brief = await getLatestBrief(match.leadId);
  const intelligence = hasIntelligence(brief) ? brief.intelligence : null;
  const contact = primaryContact(ctx.contacts, ctx.lead.primary_contact_id) ?? match.contact;

  const extraction = await extractFromReply({
    replyText: text,
    lead: ctx.lead,
    company: ctx.company,
    contact,
    intelligence,
  });

  const meta: InboundReplyMeta = {
    kind: "inbound_reply",
    from_email: from,
    subject,
    text,
    facts: extraction.facts,
    systems: extraction.systems,
    summary: extraction.summary || "Inbound email reply captured.",
    generated_by: extraction.generated_by,
    model: extraction.model,
    note: extraction.note,
    confirmed_indices: [],
    applied: [],
    confirmed_at: null,
    confirmed_by: null,
  };
  const activity = await recordInboundReply(match.leadId, meta, match.contact.name);

  // The reply is now on the timeline, so the brief re-reads it as evidence
  // and the agent's next recommended action reflects that the customer wrote
  // back — non-fatal: a slow or failed refresh should never make the capture
  // itself fail.
  await scheduleRefresh(match.leadId, {}, ["/", "/pipeline"]);

  revalidatePath(`/leads/${match.leadId}`);
  revalidatePath("/");
  revalidatePath("/pipeline");

  return NextResponse.json(
    { leadId: match.leadId, activityId: activity.id, factsFound: extraction.facts.length + extraction.systems.length },
    { status: 201, headers: cors() }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-inbound-email-key",
    "access-control-allow-methods": "POST, OPTIONS",
  };
}
