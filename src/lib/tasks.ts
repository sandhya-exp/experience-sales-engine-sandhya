import type { OpportunityInsight } from "@/lib/insights";
import { canAccessContract, type Role } from "@/lib/roles";
import type { ScheduledItem } from "@/lib/repo/schedule";

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
  | "quote_handoff";

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
};

function isToday(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

export function buildTasks(insights: OpportunityInsight[], upcoming: ScheduledItem[], overdue: ScheduledItem[]): SalesTask[] {
  const tasks: SalesTask[] = [];

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
 * The same list, filtered to what the role may act on. A Sales User never sees
 * "continue to the quote" tasks: the handoff is not theirs to perform, and a
 * to-do you are not allowed to do is worse than no to-do at all.
 */
export function tasksForRole(tasks: SalesTask[], role: Role): SalesTask[] {
  if (canAccessContract(role)) return tasks;
  return tasks.filter((t) => t.kind !== "quote_handoff");
}
