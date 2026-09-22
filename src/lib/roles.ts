/**
 * Three roles, three gates.
 *
 * Sales Employee — the whole lead lifecycle: inquiries, pipeline, the
 *   opportunity workspace, contacts, activity, qualification, the AI brief,
 *   meetings and tasks. Drafts quotes, but does not release them.
 * Sales Manager — the same, plus the commercial gate: approves a quote and
 *   sends it to the customer, and sees the team's reports rather than only
 *   their own book.
 * Admin — the same as a manager, plus the handoff boundary and the controls
 *   that sit above the team: Ready to Contract, the quote context review, the
 *   contract module, and overriding who a lead is assigned to.
 *
 * Each gate is a named predicate rather than a permission matrix, because the
 * product genuinely has only three of them. Every check — nav, page, server
 * action, API route and the proxy in front of the contract module — reads them
 * from here, so the UI and the server can never disagree.
 */
export const ROLES = ["admin", "manager", "sales"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  manager: "Sales Manager",
  sales: "Sales Employee",
};

export const ROLE_DESCRIPTIONS: Record<Role, string> = {
  admin: "Everything a manager can do, plus the contract handoff and lead reassignment.",
  manager: "Approves quotes and sends them to customers; sees the whole team's pipeline and reports.",
  sales: "Works leads end to end and drafts quotes for approval.",
};

/** The default for any account without an explicit role — least privilege. */
export const DEFAULT_ROLE: Role = "sales";

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Coerce whatever the database returned into a role, defaulting to the lowest. */
export function toRole(value: unknown): Role {
  return isRole(value) ? value : DEFAULT_ROLE;
}

/* ------------------------------------------------------------------- gates */

/**
 * Release a quote: approve it, send it to the customer, recall it.
 * A Sales Employee drafts and clones; a Manager or Admin is what turns a draft
 * into something a customer sees. This is the approver in the approval chain.
 */
export function canApproveQuotes(role: Role | null | undefined): boolean {
  return role === "manager" || role === "admin";
}

/** Ready to Contract, the quote context review, the handoff, the contract module. */
export function canAccessContract(role: Role | null | undefined): boolean {
  return role === "admin";
}

/**
 * Reassign a lead away from whoever holds it. The agent's own SLA reassignment
 * is not gated by this — it is the system acting on a rule, recorded as such —
 * but a person overriding an assignment is an admin action.
 */
export function canReassignLeads(role: Role | null | undefined): boolean {
  return role === "admin";
}

/**
 * See the whole team in Reports. A Sales Employee's reports are scoped to the
 * leads they own, which is the honest answer to "how am I doing"; a manager or
 * admin is asking about the team.
 */
export function canViewTeamReports(role: Role | null | undefined): boolean {
  return role === "manager" || role === "admin";
}
