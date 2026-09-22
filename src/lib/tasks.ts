import type { OpportunityInsight } from "@/lib/insights";
import { canAccessContract, canApproveQuotes, type Role } from "@/lib/roles";
import type { ScheduledItem } from "@/lib/repo/schedule";
import type { AgentActionListRow } from "@/lib/repo/agentActions";
import { effectiveStatus, formatMoney, type QuoteListRow } from "@/lib/repo/quotes";

/**
 * Scheduled Tasks — one list of everything on a salesperson's plate.
 *
 * Booked meetings and calls sit here alongside the things with no time on them
 * (an unowned opportunity, a qualification gap, the AI's next action), because
 * the question someone asks when they log in is "what do I have to do", not
 * "what is in my calendar" and separately "what is on my list".
 *
 * None of it is a new record — there is no tasks table and there shouldn't be
 * one. Every item is derived from something that already exists on an
 * opportunity: a booked call, one whose time has passed, an opportunity nobody
 * owns, a gap the AI found, its recommended next action. So the list can never
 * drift from the pipeline, and doing the work clears the item on its own.
 */
export type TaskKind =
  | "missed_call"
  | "call_today"
  | "call_upcoming"
  | "unassigned"
  | "qualification_gap"
  | "ai_next_action"
  | "quote_handoff"
  | "agent_approval"
  | "agent_waiting"
  | "quote_approval"
  | "quote_follow_up";

export interface SalesTask {
  id: string;
  kind: TaskKind;
  /** What to do. */
  title: string;
  /** Why it is on the list — the record it came from. */
  reason: string;
  leadId: string;
  companyName: string;
  ownerName: string | null;
  /** When it was due / is due, when the source record has a time. */
  due: string | null;
  overdue: boolean;
  priority: number; // lower sorts first
  href: string;
}

export const TASK_KIND_LABELS: Record<TaskKind, string> = {
  missed_call: "Missed call",
  call_today: "Today",
  call_upcoming: "Meeting",
  unassigned: "Unassigned",
  qualification_gap: "Qualification gap",
  ai_next_action: "AI next action",
  quote_handoff: "Quote handoff",
  agent_approval: "Needs approval",
  agent_waiting: "Waiting for customer",
  quote_approval: "Quote approval",
  quote_follow_up: "Quote follow-up",
};

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

export function buildTasks(insights: OpportunityInsight[], upcoming: ScheduledItem[], overdue: ScheduledItem[], agentActions: AgentActionListRow[] = [], quotes: QuoteListRow[] = []): SalesTask[] {
  const tasks: SalesTask[] = [];

  /* Quotes that need a person: a draft the check flagged (admin approval), and a
     sent quote the customer has gone quiet on. Both clear themselves when the
     quote moves. */
  for (const q of quotes.filter((q) => !q.meta.superseded && q.leadStatus !== "won" && q.leadStatus !== "lost")) {
    const status = effectiveStatus(q.meta);
    if (status === "draft" && q.meta.review.needs_approval) {
      tasks.push({
        id: `quote-approve:${q.activityId}`,
        kind: "quote_approval",
        title: `Approve quote v${q.meta.version} for ${q.companyName} — ${formatMoney(q.meta.total)}`,
        reason: q.meta.review.issues.join(" "),
        leadId: q.leadId,
        companyName: q.companyName,
        ownerName: q.ownerName,
        due: null,
        overdue: false,
        priority: 1,
        href: `/leads/${q.leadId}?tab=quotes`,
      });
      continue;
    }
    if (status === "sent" || status === "viewed") {
      const sentAt = q.meta.history.find((h) => h.status === "sent")?.at ?? q.createdAt;
      const days = Math.floor((Date.now() - new Date(sentAt).getTime()) / 86_400_000);
      if (days >= 3) {
        tasks.push({
          id: `quote-follow:${q.activityId}`,
          kind: "quote_follow_up",
          title: `Follow up on quote v${q.meta.version} with ${q.companyName}`,
          reason: `Sent ${days} days ago, ${status === "viewed" ? "viewed but" : ""} no answer yet. Valid until ${q.meta.valid_until}.`,
          leadId: q.leadId,
          companyName: q.companyName,
          ownerName: q.ownerName,
          due: sentAt,
          overdue: days >= 7,
          priority: days >= 7 ? 0 : 2,
          href: `/leads/${q.leadId}?tab=quotes`,
        });
      }
    }
  }

  /* What the agent is waiting on a person for, and what it is waiting on the
     customer for. Both are real work in progress, and both clear themselves:
     approving the action or recording the reply removes the row. */
  for (const a of agentActions) {
    if (a.meta.state === "proposed" && a.meta.risk !== "green") {
      tasks.push({
        id: `agent-approve:${a.activityId}`,
        kind: "agent_approval",
        title: `Approve: ${a.meta.goal}`,
        reason: `${a.meta.rationale} ${a.meta.risk === "red" ? "Commercial ground — a person must approve it." : "Needs a person because it involves interpretation."}`,
        leadId: a.leadId,
        companyName: a.companyName,
        ownerName: a.ownerName,
        due: null,
        overdue: false,
        priority: 1,
        href: `/leads/${a.leadId}?tab=brief`,
      });
      continue;
    }
    if (a.meta.state === "executed" && a.meta.action_type === "ask_customer" && !a.meta.replied_at) {
      tasks.push({
        id: `agent-waiting:${a.activityId}`,
        kind: "agent_waiting",
        title: `Awaiting ${a.companyName}'s reply — ${a.meta.gap_label ?? a.meta.goal}`,
        reason: a.meta.executed_at ? `Asked ${new Date(a.meta.executed_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}. Record the answer when it arrives and the agent re-evaluates.` : "Record the answer when it arrives.",
        leadId: a.leadId,
        companyName: a.companyName,
        ownerName: a.ownerName,
        due: a.meta.executed_at,
        overdue: false,
        priority: 7,
        href: `/leads/${a.leadId}?tab=brief`,
      });
    }
  }

  for (const m of overdue) {
    tasks.push({
      id: `missed:${m.activityId}`,
      kind: "missed_call",
      title: `Log the outcome of ${m.title.toLowerCase()} with ${m.companyName}`,
      reason: `Booked for ${new Date(m.scheduledFor).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} — nothing logged since.`,
      leadId: m.leadId,
      companyName: m.companyName,
      ownerName: m.ownerName,
      due: m.scheduledFor,
      overdue: true,
      priority: 0,
      href: `/leads/${m.leadId}`,
    });
  }

  for (const m of upcoming.filter((u) => !isToday(u.scheduledFor))) {
    tasks.push({
      id: `meeting:${m.activityId}`,
      kind: "call_upcoming",
      title: `${m.title} with ${m.companyName}`,
      reason: `${new Date(m.scheduledFor).toLocaleString("en-US", { weekday: "long", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${m.contactName ? ` · ${m.contactName}` : ""}${m.calendar?.rep_name ? ` · ${m.calendar.rep_name}` : ""}`,
      leadId: m.leadId,
      companyName: m.companyName,
      ownerName: m.ownerName,
      due: m.scheduledFor,
      overdue: false,
      priority: 2,
      href: `/leads/${m.leadId}`,
    });
  }

  for (const m of upcoming.filter((u) => isToday(u.scheduledFor))) {
    tasks.push({
      id: `today:${m.activityId}`,
      kind: "call_today",
      title: `${m.title} with ${m.companyName}`,
      reason: `${new Date(m.scheduledFor).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}${m.contactName ? ` · ${m.contactName}` : ""}${m.calendar?.provider === "google" ? " · Google Calendar" : ""}`,
      leadId: m.leadId,
      companyName: m.companyName,
      ownerName: m.ownerName,
      due: m.scheduledFor,
      overdue: false,
      priority: 1,
      href: `/leads/${m.leadId}`,
    });
  }

  for (const i of insights) {
    if (!i.lead.owner_user_id) {
      tasks.push({
        id: `owner:${i.lead.id}`,
        kind: "unassigned",
        title: `Assign an owner to ${i.lead.company_name}`,
        reason: `${i.lead.status === "new" ? "New inquiry" : "Open opportunity"} with nobody responsible for it.`,
        leadId: i.lead.id,
        companyName: i.lead.company_name,
        ownerName: null,
        due: null,
        overdue: false,
        priority: 3,
        href: `/leads/${i.lead.id}`,
      });
    }

    if (i.ready && i.lead.status === "qualified") {
      tasks.push({
        id: `handoff:${i.lead.id}`,
        kind: "quote_handoff",
        title: `Continue ${i.lead.company_name} to the quote`,
        reason: `Qualification is complete (${i.readinessPassed}/${i.readinessTotal} checks) and the quote context is ready.`,
        leadId: i.lead.id,
        companyName: i.lead.company_name,
        ownerName: i.lead.owner_name,
        due: null,
        overdue: false,
        priority: 4,
        href: `/leads/${i.lead.id}/quote`,
      });
      continue;
    }

    // One qualification task per opportunity, naming the gaps — not one per field.
    if (i.missing.length > 0 && i.lead.status !== "new") {
      tasks.push({
        id: `gap:${i.lead.id}`,
        kind: "qualification_gap",
        title: `Capture ${i.missing.slice(0, 2).join(" and ").toLowerCase()}${i.missing.length > 2 ? ` +${i.missing.length - 2} more` : ""} for ${i.lead.company_name}`,
        reason: `AI Opportunity Intelligence flagged ${i.missing.length} qualification gap${i.missing.length === 1 ? "" : "s"} blocking the quote handoff.`,
        leadId: i.lead.id,
        companyName: i.lead.company_name,
        ownerName: i.lead.owner_name,
        due: null,
        overdue: false,
        priority: 5,
        href: `/leads/${i.lead.id}`,
      });
      continue;
    }

    if (i.nextAction && i.lead.status === "new") {
      tasks.push({
        id: `ai:${i.lead.id}`,
        kind: "ai_next_action",
        title: `${i.nextAction} — ${i.lead.company_name}`,
        reason: i.nextActionReason ?? "Recommended by AI Opportunity Intelligence.",
        leadId: i.lead.id,
        companyName: i.lead.company_name,
        ownerName: i.lead.owner_name,
        due: null,
        overdue: false,
        priority: 6,
        href: `/leads/${i.lead.id}`,
      });
    }
  }

  return tasks.sort((a, b) => a.priority - b.priority || (a.due ?? "").localeCompare(b.due ?? ""));
}

/**
 * The same list, filtered to what the role may act on — a to-do you are not
 * allowed to do is worse than no to-do at all. An approval belongs to whoever
 * can approve (manager or admin); the contract handoff is the admin's alone.
 */
export function tasksForRole(tasks: SalesTask[], role: Role): SalesTask[] {
  return tasks.filter((t) => {
    if (t.kind === "quote_handoff") return canAccessContract(role);
    if (t.kind === "quote_approval") return canApproveQuotes(role);
    return true;
  });
}
