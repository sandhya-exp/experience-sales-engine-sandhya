import { findProduct, type Product } from "@/lib/catalog/catalog";
import type { Activity, LeadStatus, Qualification } from "@/lib/types";

/**
 * Small, client-safe readings of a deal that the pipeline board, the deal
 * header and the reports all want to agree on:
 *
 *   - an estimated value for an opportunity that has not been quoted yet
 *   - when the deal entered its current stage
 *   - why a deal was lost
 *
 * Nothing here is stored. Everything is derived from the lead row, the price
 * list and the `status_change` activities the workspace already writes.
 */

/* ------------------------------------------------------------ estimate */

export interface DealEstimate {
  amount: number;
  product: Product;
  units: number;
  /** One line a rep can read to see where the number came from. */
  basis: string;
}

/**
 * A pre-quote estimate: the product the inquiry's interest maps to, times the
 * number of users the customer gave. Always labelled as an estimate wherever
 * it is shown — it is a list-price reading of the inquiry, not a price, and it
 * disappears the moment a real quote exists.
 *
 * Location-priced products have no estimate: the inquiry asks for users, not
 * locations, and guessing one from the other would be inventing a number.
 */
export function estimateDealValue(lead: { interest: string | null; number_of_users: number | null; qualification?: Qualification | null }): DealEstimate | null {
  const text = [lead.interest ?? "", lead.qualification?.primary_need ?? ""].join(" ").trim();
  if (!text) return null;
  const product = findProduct(text);
  if (!product) return null;
  const users = lead.qualification?.number_of_users ?? lead.number_of_users ?? 0;

  if (product.unit === "platform") {
    return { amount: product.list_price, product, units: 1, basis: `${product.name} platform at list price` };
  }
  if (product.unit === "user" && users > 0) {
    return { amount: product.list_price * users, product, units: users, basis: `${users} users × ${product.name} list price` };
  }
  return null;
}

/* ------------------------------------------------------------- stage age */

/** When the deal entered its current stage: the latest status_change into it, else creation. */
export function stageEnteredAt(activities: Activity[], status: LeadStatus, createdAt: string): Date {
  const move = activities
    .filter((a) => a.type === "status_change" && (a.metadata?.to === status || (typeof a.body === "string" && a.body.endsWith(`to ${status}.`))))
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())[0];
  return new Date(move?.occurred_at ?? createdAt);
}

/* ---------------------------------------------------------------- lost */

export const LOST_REASONS = [
  "Price",
  "Chose a competitor",
  "No budget",
  "Timing — not now",
  "No response",
  "Not a fit",
  "Other",
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

export function lostReasonFor(activities: Activity[]): { reason: string; note: string | null; at: Date } | null {
  const move = activities
    .filter((a) => a.type === "status_change" && a.metadata?.to === "lost")
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())[0];
  if (!move) return null;
  const reason = typeof move.metadata?.reason === "string" ? move.metadata.reason : null;
  if (!reason) return null;
  return { reason, note: typeof move.metadata?.note === "string" ? move.metadata.note : null, at: new Date(move.occurred_at) };
}

/* -------------------------------------------------------------- source */

/** Answers to "How did you hear about us?" on the public form. */
export const LEAD_SOURCES = [
  "Search engine",
  "Referral",
  "Event or conference",
  "LinkedIn or social media",
  "Existing customer",
  "Partner",
  "Other",
] as const;
