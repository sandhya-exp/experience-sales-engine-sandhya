"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { AlertTriangle, Bot, CheckCircle2, ChevronRight, Clock, Mail, Pencil, Send, ShieldAlert, ShieldCheck, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { approveAgentAction, declineAgentActionAction, setAutoModeAction } from "@/app/actions/agent";
import { AiProgress, useAiRun } from "@/components/workspace/ai-progress";
import type { AgentActionRow, AgentRisk, CustomerReplyMeta } from "@/lib/repo/agentActions";
import { DELIVERY_LABEL } from "@/lib/email/provider";

/** Record sources the agent cites. Knowledge documents are named in the trace, not here. */
function sourceLabel(ref: string) {
  if (ref === "inquiry") return "Customer inquiry";
  if (ref === "qualification") return "Qualification";
  if (ref.startsWith("contact:")) return `Contact · ${ref.slice(8)}`;
  if (ref.startsWith("activity:")) return `Activity #${ref.slice(9)}`;
  return ref;
}

/**
 * AI Actions — the second and last card on the AI tab.
 *
 * Read top to bottom it answers three questions in order: **what happened**
 * (the trigger that woke the agent, and the customer's reply when there is
 * one), **what to do next** (one action, never a menu), and then **do it** (the
 * buttons). Everything else — why this action, the evidence, the risk band, the
 * full trace — is support for that middle line, and the trace itself is folded.
 *
 * One action rather than a ranked list, because a list of suggestions is a
 * decision the product declined to make. Each block is a field on the stored
 * action, which is itself a row on the activity timeline.
 */
export function AgentActionCard({
  leadId,
  action,
  autoMode,
  providerLabel,
  lastReply,
}: {
  leadId: string;
  action: AgentActionRow | null;
  autoMode: boolean;
  providerLabel: string;
  /** The customer's most recent reply, with what it changed. */
  lastReply?: { occurredAt: string; meta: CustomerReplyMeta } | null;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const check = useAiRun(leadId);

  if (!action) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-md bg-navy text-white">
              <Bot className="h-3.5 w-3.5" />
            </span>
            AI Actions
          </CardTitle>
          <Button
            size="sm"
            variant="outline"
            disabled={check.running}
            onClick={async () => {
              const r = await check.run({ op: "refresh" });
              if (r.ok) {
                toast.message(r.detail);
                router.refresh();
              } else toast.error(r.detail);
            }}
          >
            {check.running ? "Checking…" : "Check again"}
          </Button>
        </CardHeader>
        <CardContent className="pt-0">
          {check.running ? (
            <AiProgress op="refresh" stage={check.stage} className="mb-2" />
          ) : (
            <p className="text-[13px] text-muted-foreground">
              Nothing to do here right now — the agent proposes an action only when the record gives it one to take.
            </p>
          )}
          {lastReply && <CustomerResponsePanel reply={lastReply} />}
        </CardContent>
      </Card>
    );
  }

  const { meta } = action;
  const executed = meta.state === "executed";
  const waiting = executed && meta.action_type === "ask_customer" && !meta.replied_at;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-navy text-white">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          Recommended Action
          <RiskBadge risk={meta.risk} />
          <StateBadge state={meta.state} />
        </CardTitle>
        {!executed && meta.state !== "declined" && <AutoToggle leadId={leadId} enabled={autoMode} disabled={pending} />}
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {/* What happened — the record that woke the agent. The customer's own
            words, when there are any, are the panel further down. */}
        {meta.trace.trigger && (
          <p className="flex items-start gap-2 text-[13px] leading-snug text-muted-foreground">
            <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              <span className="font-medium text-foreground">What happened: </span>
              {meta.trace.trigger}
            </span>
          </p>
        )}

        {/* Reasoning first, on its own: goal, why, and evidence. The email
            (when there is one) is a separate card below — the artifact that
            reasoning produced, not one more thing crammed into this box. */}
        <div className={cn("rounded-xl border p-4", executed ? "border-success/30 bg-success/5" : meta.risk === "red" ? "border-destructive/30 bg-destructive/5" : "border-navy/20 bg-[#eef2fb]")}>
          <p className="text-[17px] font-semibold leading-snug text-foreground">{meta.goal}</p>

          <dl className="mt-3 grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
            <Field label="Why this action">{meta.rationale}</Field>
            <Field label="Automation">
              <span className={cn(meta.risk === "green" ? "text-success" : meta.risk === "red" ? "text-destructive" : "text-foreground")}>{RISK_TEXT[meta.risk]}</span>
            </Field>
          </dl>

          {meta.evidence.length > 0 && !executed && (
            <div className="mt-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Evidence</p>
              <ul className="mt-1.5 space-y-1">
                {meta.evidence.map((e, i) => (
                  <li key={i} className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-card/80 px-2.5 py-1.5 text-[12.5px] leading-snug">
                    <span className="text-foreground">{e.claim}</span>
                    <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">{sourceLabel(e.source)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!meta.draft_message && !executed && meta.state !== "declined" && (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={pending} onClick={() => startTransition(async () => { toast.message((await approveAgentAction(action.activityId)).detail); })}>
                <CheckCircle2 className="h-3.5 w-3.5" /> Accept this action
              </Button>
              <Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => { toast.message((await declineAgentActionAction(action.activityId)).detail); })}>
                <X className="h-3.5 w-3.5" /> Not now
              </Button>
            </div>
          )}
        </div>

        {/* The proposed email, as its own card — separated from the reasoning
            above rather than nested inside it, so each reads as a distinct
            block: why this, then here's the actual message. */}
        {meta.draft_message && !executed && <ProposedEmailBlock leadId={leadId} action={action} providerLabel={providerLabel} />}

        {/* Once the action has run, the story compresses to one line per step:
            sent → waiting → reply. The email body, the provider's delivery
            detail and the tool calls all live in the trace below. */}
        {executed && <DoneStrip action={action} />}

        {waiting && <WaitingForReply leadId={leadId} inReplyTo={action.activityId} />}

        {lastReply && <CustomerResponsePanel reply={lastReply} />}

        <AgentTracePanel action={action} />
      </CardContent>
    </Card>
  );
}

/* ------------------------------------------------------------------- email */

/**
 * Proposed email — the artifact the reasoning above produced, previewed
 * compactly right inside the same card. Collapsed, it shows only what's
 * needed to decide: who it's to, the subject, and a couple of lines of body,
 * with Send / Edit / Decline always visible so approving doesn't require
 * expanding anything. "Preview" reveals the full body inline; editing forces
 * it open. Same data and server actions as before — only the layout changed.
 */
function ProposedEmailBlock({ leadId, action, providerLabel }: { leadId: string; action: AgentActionRow; providerLabel: string }) {
  const { meta } = action;
  const draft = meta.draft_message!;
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [pending, startTransition] = useTransition();
  const done = meta.state === "executed";
  const failed = meta.delivery?.state === "failed";
  const showFull = expanded || editing;
  void leadId;

  const fullBody = done ? draft.body : body;
  const preview = fullBody
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(" ");

  return (
    <div className="mt-3 overflow-hidden rounded-lg border-2 border-navy/25 bg-card shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-navy/15 bg-[#eef2fb] px-3 py-1.5">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-navy">
          <Mail className="h-3 w-3" /> Proposed email
        </p>
        <div className="flex items-center gap-1.5">
          <Badge variant={draft.generated_by === "claude" ? "navy" : "outline"} className="font-medium" title={draft.generated_by === "claude" ? `Written by Claude (${draft.model}) and checked against the record` : "Written by the deterministic engine"}>
            {draft.generated_by === "claude" ? `Claude${draft.model ? ` · ${draft.model.replace(/^claude-/, "")}` : ""}` : "Deterministic"}
          </Badge>
          {meta.delivery && <DeliveryBadge state={meta.delivery.state} />}
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" disabled={editing} onClick={() => setExpanded((e) => !e)}>
            {showFull ? "Collapse" : "Preview"}
          </Button>
        </div>
      </div>

      <div className="px-3 py-2.5">
        <p className="text-[13px] font-semibold text-foreground">{done ? draft.subject : subject}</p>
        <p className="mt-0.5 text-[11.5px] text-muted-foreground">
          To {draft.to.name ?? draft.to.email} <span>· {draft.to.email}</span>
        </p>

        {showFull ? (
          editing ? (
            <div className="mt-2 space-y-2">
              <div>
                <Label htmlFor="agent-subject" className="text-[12px]">Subject</Label>
                <Input id="agent-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="agent-body" className="text-[12px]">Message</Label>
                <Textarea id="agent-body" rows={10} value={body} onChange={(e) => setBody(e.target.value)} />
              </div>
            </div>
          ) : (
            <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{fullBody}</p>
          )
        ) : (
          <p className="mt-1.5 truncate text-[12.5px] leading-snug text-muted-foreground">{preview}</p>
        )}
      </div>

      {meta.delivery && (meta.state === "executed" || failed) && (
        <p className={cn("border-t border-border px-3 py-2 text-[12px]", failed ? "text-destructive" : "text-muted-foreground")}>{meta.delivery.detail}</p>
      )}

      {meta.state !== "executed" && meta.state !== "declined" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border bg-muted/30 px-3 py-2">
          <Button
            size="sm"
            disabled={pending}
            onClick={() =>
              startTransition(async () => {
                const fd = new FormData();
                fd.set("subject", subject);
                fd.set("body", body);
                const r = await approveAgentAction(action.activityId, fd);
                if (r.ok) toast.success(r.detail);
                else toast.error(r.detail);
              })
            }
          >
            <Send className="h-3.5 w-3.5" /> {meta.risk === "green" ? "Send" : "Approve & send"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => {
              setEditing((e) => !e);
              setExpanded(true);
            }}
          >
            <Pencil className="h-3.5 w-3.5" /> {editing ? "Done editing" : "Edit"}
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => startTransition(async () => { toast.message((await declineAgentActionAction(action.activityId)).detail); })}>
            <X className="h-3.5 w-3.5" /> Decline
          </Button>
          <span className="ml-auto text-[11px] text-muted-foreground">{providerLabel}</span>
        </div>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------- done */

/**
 * The executed action in one line: what went out, to whom, when — with the
 * email body one click away. Provider mechanics ("set EMAIL_PROVIDER=…") are
 * deliberately not here; they are in the trace for whoever needs them.
 */
function DoneStrip({ action }: { action: AgentActionRow }) {
  const { meta } = action;
  const draft = meta.draft_message;
  const [open, setOpen] = useState(false);
  const when = meta.executed_at ? new Date(meta.executed_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : null;
  const delivery = meta.delivery?.state;
  const verb = draft ? (delivery === "sent" ? "Email sent" : delivery === "failed" ? "Email failed" : "Email approved") : "Done";

  return (
    <div className={cn("rounded-lg border px-3 py-2.5", delivery === "failed" ? "border-destructive/30 bg-destructive/5" : "border-success/30 bg-success/5")}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <CheckCircle2 className={cn("h-4 w-4 shrink-0", delivery === "failed" ? "text-destructive" : "text-success")} />
        <p className="text-[13px] font-medium text-foreground">
          {verb}
          {draft ? <span className="font-normal text-muted-foreground"> to {draft.to.name ?? draft.to.email}</span> : null}
        </p>
        {when && <span className="text-[12px] text-muted-foreground">· {when}{meta.auto ? " · automatic" : ""}</span>}
        {meta.delivery && <DeliveryBadge state={meta.delivery.state} />}
        {draft && (
          <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px]" onClick={() => setOpen((o) => !o)}>
            {open ? "Hide email" : "View email"}
          </Button>
        )}
      </div>
      {draft && open && (
        <div className="mt-2 rounded-md border border-border bg-card px-3 py-2">
          <p className="text-[13px] font-semibold text-foreground">{draft.subject}</p>
          <p className="text-[11.5px] text-muted-foreground">To {draft.to.name ?? draft.to.email} · {draft.to.email}</p>
          <p className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-foreground">{draft.body}</p>
        </div>
      )}
    </div>
  );
}

/**
 * The wait state, kept small on purpose. The reply normally arrives on its
 * own through the inbound-email webhook; pasting one by hand is the fallback
 * (and the demo path), so it is a link, not an open form.
 */
function WaitingForReply({ leadId, inReplyTo }: { leadId: string; inReplyTo: string }) {
  const [manual, setManual] = useState(false);
  return (
    <div className="rounded-lg border border-dashed border-border px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Clock className="h-4 w-4 shrink-0 text-navy" />
        <p className="text-[13px] font-medium text-foreground">Waiting for the customer to reply</p>
        <span className="text-[12px] text-muted-foreground">· the reply is captured and analyzed automatically when it arrives</span>
        {!manual && (
          <Button size="sm" variant="ghost" className="ml-auto h-6 px-2 text-[11px]" onClick={() => setManual(true)}>
            Paste a reply manually
          </Button>
        )}
      </div>
      {manual && <ReplyBox leadId={leadId} inReplyTo={inReplyTo} startOpen onClose={() => setManual(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------- reply */

function ReplyBox({ leadId, inReplyTo, startOpen = false, onClose }: { leadId: string; inReplyTo: string; startOpen?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(startOpen);
  const [text, setText] = useState("");
  const router = useRouter();
  const { run, stage, running: pending } = useAiRun(leadId);
  const [result, setResult] = useState<{ applied: string[]; resolvedGaps: string[]; readinessBefore: string | null; readinessAfter: string | null; nextAction: string | null } | null>(null);

  if (result) {
    return (
      <div className="mt-3 rounded-lg border border-success/30 bg-card px-3 py-3">
        <p className="section-label text-success">Customer response processed</p>
        <ul className="mt-1.5 space-y-1 text-[13px] text-foreground">
          <li className="flex items-start gap-1.5">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
            {result.applied.length ? <span>Extracted and applied: {result.applied.join(" · ")}</span> : <span className="text-muted-foreground">Nothing in the reply could be quoted as a new fact, so nothing was written.</span>}
          </li>
          {result.resolvedGaps.length > 0 && (
            <li className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> Gap resolved: {result.resolvedGaps.join(", ")}
            </li>
          )}
          {result.readinessBefore && result.readinessAfter && (
            <li className="flex items-start gap-1.5">
              <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-navy" /> Readiness {result.readinessBefore} → <span className="font-medium">{result.readinessAfter}</span>
            </li>
          )}
          {result.nextAction && (
            <li className="flex items-start gap-1.5">
              <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-navy" /> New next action: <span className="font-medium">{result.nextAction}</span>
            </li>
          )}
        </ul>
        <p className="mt-2 text-[11px] text-muted-foreground">The intelligence and next action above have been regenerated.</p>
      </div>
    );
  }

  return (
    <div className="mt-3">
      {!open ? (
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Mail className="h-3.5 w-3.5" /> Enter the customer&rsquo;s reply
        </Button>
      ) : (
        <div className="rounded-lg border border-border bg-card px-3 py-2.5">
          <Label htmlFor="agent-reply" className="text-[12px]">
            Customer reply
          </Label>
          <Textarea id="agent-reply" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste what the customer wrote back." />
          <p className="mt-1 text-[11px] text-muted-foreground">Only facts that can be quoted from this text are written to the opportunity.</p>
          {pending && <AiProgress op="reply" stage={stage} className="mt-2" />}
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              disabled={pending || !text.trim()}
              onClick={async () => {
                const r = await run({ op: "reply", text, inReplyTo });
                if (!r.ok) {
                  toast.error(r.detail);
                  return;
                }
                toast.success(r.detail);
                setResult({ applied: r.applied ?? [], resolvedGaps: r.resolvedGaps ?? [], readinessBefore: r.readinessBefore ?? null, readinessAfter: r.readinessAfter ?? null, nextAction: r.nextAction ?? null });
                router.refresh();
              }}
            >
              {pending ? "Processing…" : "Process reply"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setOpen(false); onClose?.(); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------- customer transition */

/**
 * What the customer's answer actually changed.
 *
 * Read from the stored reply rather than from anything the screen remembered,
 * so the before/after is still here tomorrow and on someone else's machine —
 * a claim about what the agent achieved should be part of the record.
 */
function CustomerResponsePanel({ reply }: { reply: { occurredAt: string; meta: CustomerReplyMeta } }) {
  const { meta } = reply;
  const t = meta.transition;
  const facts = meta.extracted.length;
  const gaps = t?.resolved_gaps?.length ?? 0;
  const summary = [
    `${facts} fact${facts === 1 ? "" : "s"} found`,
    gaps ? `${gaps} question${gaps === 1 ? "" : "s"} answered` : null,
    t?.readiness_before && t?.readiness_after && t.readiness_before !== t.readiness_after ? `readiness ${t.readiness_before} → ${t.readiness_after}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <details className="group mt-3 rounded-lg border border-navy/25 bg-card">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2.5 [&::-webkit-details-marker]:hidden">
        <Sparkles className="h-4 w-4 shrink-0 text-navy" />
        <span className="text-[13px] font-medium text-foreground">Customer replied</span>
        <span className="text-[12px] text-muted-foreground">· {summary}</span>
        <span className="ml-auto text-[11px] text-muted-foreground">
          {new Date(reply.occurredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
        </span>
        <span className="text-[12px] font-medium text-navy group-open:hidden">Review findings</span>
        <span className="hidden text-[12px] font-medium text-navy group-open:inline">Hide</span>
      </summary>
      <p className="border-y border-border px-3 py-2 text-[13px] italic leading-snug text-foreground">&ldquo;{meta.text}&rdquo;</p>
      <ul className="space-y-1 px-3 py-2.5 text-[13px]">
        {meta.extracted.length > 0 ? (
          meta.extracted.map((e, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              <span>
                <span className="font-medium text-foreground">{e.label}: {e.value}</span>
                <span className="ml-1 text-muted-foreground">&mdash; from &ldquo;{e.quote.length > 70 ? `${e.quote.slice(0, 69)}…` : e.quote}&rdquo;</span>
              </span>
            </li>
          ))
        ) : (
          <li className="text-muted-foreground">Nothing in the reply could be quoted as a new fact, so nothing was written.</li>
        )}
        {meta.applied.length > 0 && (
          <li className="flex items-start gap-1.5">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> Opportunity updated: {meta.applied.join(" · ")}
          </li>
        )}
        {t?.resolved_gaps && t.resolved_gaps.length > 0 && (
          <li className="flex items-start gap-1.5">
            <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" /> Gap resolved: {t.resolved_gaps.join(", ")}
          </li>
        )}
        {t?.readiness_before && t?.readiness_after && (
          <li className="flex items-start gap-1.5">
            <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-navy" /> Readiness {t.readiness_before} &rarr; <span className="font-medium">{t.readiness_after}</span>
          </li>
        )}
        {t?.next_action_after && t.next_action_after !== t.next_action_before && (
          <li className="flex items-start gap-1.5">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-navy" /> New next action: <span className="font-medium">{t.next_action_after}</span>
          </li>
        )}
        <li className="pt-1 text-[11px] text-muted-foreground">
          {meta.generated_by === "claude" ? `Read by Claude${meta.model ? ` · ${meta.model.replace(/^claude-/, "")}` : ""}` : "Read deterministically"} — only facts quotable from the reply were written.
        </li>
      </ul>
    </details>
  );
}

/* ------------------------------------------------------------------ trace */

function AgentTracePanel({ action }: { action: AgentActionRow }) {
  const t = action.meta.trace;
  const rows: [string, React.ReactNode][] = [
    ["Trigger", t.trigger],
    ["Data used", t.data_used.join(" · ")],
    ["Knowledge", t.knowledge.length ? t.knowledge.map((k) => k.title).join(" · ") : "No documents retrieved for this decision."],
    ["Decision", t.decision],
    ["Action", `${ACTION_LABEL[action.meta.action_type]}${action.meta.gap_label ? ` — ${action.meta.gap_label}` : ""}`],
    ["Result", t.result ?? "Not executed yet."],
    ...(action.meta.delivery ? ([["Delivery", `${DELIVERY_LABEL[action.meta.delivery.state]} — ${action.meta.delivery.detail}`]] as [string, React.ReactNode][]) : []),
  ];
  return (
    <details className="group mt-3 rounded-lg border border-border bg-card">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[12px] font-medium text-foreground [&::-webkit-details-marker]:hidden">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-navy" /> Agent trace
          {t.tools_invoked && t.tools_invoked.length > 0 && <span className="font-normal text-muted-foreground">· {t.tools_invoked.join(" → ")}</span>}
        </span>
        <span className="text-[12px] text-muted-foreground group-open:hidden">Show</span>
        <span className="hidden text-[12px] text-muted-foreground group-open:inline">Hide</span>
      </summary>
      <dl className="border-t border-border px-3 py-2.5 text-[12.5px]">
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[92px_1fr] gap-2 py-1">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
            <dd className="text-foreground">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/* ----------------------------------------------------------------- pieces */

function AutoToggle({ leadId, enabled, disabled }: { leadId: string; enabled: boolean; disabled: boolean }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant={enabled ? "outline" : "ghost"}
      className="text-xs"
      disabled={disabled || pending}
      title="Only low-risk actions ever run automatically. Approval-required actions always wait for a person."
      onClick={() => startTransition(async () => { toast.message((await setAutoModeAction(leadId, !enabled)).detail); })}
    >
      {enabled ? <ShieldCheck className="h-3.5 w-3.5 text-success" /> : <ShieldAlert className="h-3.5 w-3.5" />}
      {enabled ? "Auto: low-risk on" : "Auto: off"}
    </Button>
  );
}

const RISK_TEXT: Record<AgentRisk, string> = {
  green: "Low risk — routine and evidence-backed. Safe to run without a person.",
  yellow: "Needs approval — it involves interpretation or the customer relationship.",
  red: "Approval required — commercial ground. Never automatic.",
};

const ACTION_LABEL: Record<AgentActionRow["meta"]["action_type"], string> = {
  ask_customer: "Ask the customer",
  schedule_follow_up: "Schedule a follow-up",
  prepare_call: "Prepare for the call",
  internal_task: "Internal task",
};

function RiskBadge({ risk }: { risk: AgentRisk }) {
  const variant = risk === "green" ? "success" : risk === "yellow" ? "warning" : "destructive";
  const label = risk === "green" ? "Low risk" : risk === "yellow" ? "Approval" : "Approval · commercial";
  return (
    <Badge variant={variant} className="font-medium" title={RISK_TEXT[risk]}>
      {risk !== "green" && <AlertTriangle className="mr-1 h-3 w-3" />}
      {label}
    </Badge>
  );
}

function StateBadge({ state }: { state: AgentActionRow["meta"]["state"] }) {
  if (state === "proposed") return null;
  const map = { approved: "outline", executed: "success", declined: "outline" } as const;
  const label = { approved: "Approved", executed: "Done", declined: "Declined" } as const;
  return (
    <Badge variant={map[state]} className="font-medium">
      {label[state]}
    </Badge>
  );
}

function DeliveryBadge({ state }: { state: keyof typeof DELIVERY_LABEL }) {
  const variant = state === "sent" ? "success" : state === "failed" ? "destructive" : state === "recorded" ? "warning" : "outline";
  return (
    <Badge variant={variant} className="font-medium" title={state === "recorded" ? "The development provider stored this message; it was not delivered to the customer." : undefined}>
      {DELIVERY_LABEL[state]}
    </Badge>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-[13px] leading-snug text-foreground">{children}</dd>
    </div>
  );
}
