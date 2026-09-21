/**
 * Two roles, one rule.
 *
 * Sales User — the whole lead lifecycle up to and including Scheduled Tasks:
 *   inquiries, pipeline, the opportunity workspace, contacts, activity,
 *   qualification, the AI Deal Brief, meetings and tasks.
 * Admin — the same, plus the handoff boundary and everything past it:
 *   Ready to Contract, the quote context review, and the contract module.
 *
 * The boundary is deliberately a single predicate (`canAccessContract`) rather
 * than a permission matrix: there is exactly one gate in the product, and every
 * check — nav, page, server action, API route and the proxy in front of the
 * contract module — reads it from here, so the UI and the server can never
 * disagree about what a Sales User may do.
 */
export const ROLES = ["admin", "sales"] as const;

export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: "Admin",
  sales: "Sales User",
};

/** The default for any account without an explicit role — least privilege. */
export const DEFAULT_ROLE: Role = "sales";

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLES as readonly string[]).includes(value);
}

/** Coerce whatever the database returned into a role, defaulting to the lower one. */
export function toRole(value: unknown): Role {
  return isRole(value) ? value : DEFAULT_ROLE;
}

/** Ready to Contract, the quote context review, the handoff, the contract module. */
export function canAccessContract(role: Role | null | undefined): boolean {
  return role === "admin";
}
