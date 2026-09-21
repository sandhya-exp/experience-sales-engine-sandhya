import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { InquiryInput, createInquiryLead } from "@/lib/inquiries";

/**
 * POST /api/inquiries — inbound leads from anywhere that isn't our own form:
 * a website chat agent (e.g. a Branvidia/Nuclias-style assistant), a partner
 * landing page, a marketing automation. Same path as the /inquire form, so
 * the lead lands in the pipeline with de-dup, an owner-ready record and its
 * first AI Deal Brief.
 *
 *   Headers:  Content-Type: application/json
 *             X-Inbound-Key: <INBOUND_API_KEY>
 *   Body:     { companyName, contactName, workEmail, phone?, numberOfUsers,
 *               interest, industry?, requirements, additionalInfo?, source? }
 *   Reply:    201 { leadId, companyId, companyMatched, leadUrl }
 */
export async function POST(req: Request) {
  const key = process.env.INBOUND_API_KEY;
  if (!key || req.headers.get("x-inbound-key") !== key) {
    return NextResponse.json({ error: "unauthorised" }, { status: 401, headers: cors() });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400, headers: cors() });
  }

  const { source, ...rest } = (body ?? {}) as Record<string, unknown>;
  const parsed = InquiryInput.safeParse(rest);
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) errors[String(issue.path[0])] = issue.message;
    return NextResponse.json({ error: "validation", fields: errors }, { status: 422, headers: cors() });
  }

  const label = typeof source === "string" && source.trim() ? `API (${source.trim().slice(0, 40)})` : "API";
  const { lead, company, companyMatched } = await createInquiryLead(parsed.data, label);
  revalidatePath("/");
  revalidatePath("/pipeline");

  const proto = req.headers.get("x-forwarded-proto") ?? "http";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "localhost:3000";
  return NextResponse.json(
    { leadId: lead.id, companyId: company.id, companyMatched, leadUrl: `${proto}://${host}/leads/${lead.id}` },
    { status: 201, headers: cors() }
  );
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: cors() });
}

function cors() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type, x-inbound-key",
    "access-control-allow-methods": "POST, OPTIONS",
  };
}
