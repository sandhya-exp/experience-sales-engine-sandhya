import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { handleCustomerReply, refreshOpportunity } from "@/lib/ai/agent";
import type { AiProgressStage } from "@/lib/ai/progress";

/**
 * The agent loop, streamed — for the two places a person explicitly asks the
 * AI to work and waits for it: **Refresh** on the AI tab and **Process reply**.
 *
 * A server action can only answer once, at the end, which for a four-stage
 * Claude pipeline means a 30–40 s spinner. This route runs the *same*
 * `refreshOpportunity` / `handleCustomerReply` (same stages, same grounding,
 * same evaluator, same approvals) and writes one JSON line per stage as it
 * starts, then a final `done` line with the result the action used to return.
 *
 * Body: { op: "refresh" } | { op: "reply", text, inReplyTo? }
 * Stream (NDJSON): {"stage":"read"} … {"done":true,"ok":true,…} | {"done":true,"ok":false,"detail":…}
 */
export const maxDuration = 60;

type Body = { op: "refresh" } | { op: "reply"; text: string; inReplyTo?: string | null };

export async function POST(req: Request, ctx: { params: Promise<{ leadId: string }> }) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { leadId } = await ctx.params;
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }
  if (body.op !== "refresh" && body.op !== "reply") return NextResponse.json({ error: "Unknown op." }, { status: 400 });
  if (body.op === "reply" && !body.text?.trim()) return NextResponse.json({ error: "Enter the customer's reply." }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      const onStage = (stage: AiProgressStage) => send({ stage, at: Date.now() });
      const started = Date.now();
      try {
        if (body.op === "refresh") {
          const result = await refreshOpportunity(leadId, { actorName: user.name, onStage });
          send({
            done: true,
            ok: true,
            detail: result.action ? `Proposed: ${result.action.meta.goal}` : "Intelligence refreshed — nothing new to propose.",
            duration_ms: Date.now() - started,
          });
        } else {
          const r = await handleCustomerReply({ leadId, text: body.text.trim(), inReplyToActivityId: body.inReplyTo ?? null, actorName: user.name, onStage });
          const fmt = (x: { passed: number; total: number } | null) => (x ? `${x.passed}/${x.total}` : null);
          send({
            done: true,
            ok: true,
            detail: r.applied.length ? `Applied ${r.applied.length} fact${r.applied.length === 1 ? "" : "s"} from the reply.` : "Nothing in the reply could be quoted as a new fact, so nothing was changed.",
            applied: r.applied,
            resolvedGaps: r.resolvedGaps,
            readinessBefore: fmt(r.readinessBefore),
            readinessAfter: fmt(r.readinessAfter),
            nextAction: r.nextActionAfter,
            duration_ms: Date.now() - started,
          });
        }
        for (const p of [`/leads/${leadId}`, "/", "/pipeline"]) revalidatePath(p);
      } catch (err) {
        console.error("Streamed AI run failed:", err);
        send({ done: true, ok: false, detail: err instanceof Error ? err.message : "The AI run failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" },
  });
}
