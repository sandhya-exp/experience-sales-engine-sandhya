import { z } from "zod";
import { INDUSTRIES } from "@/lib/industries";

/**
 * Validation for an inbound inquiry. Client-safe (no server imports) so the
 * Talk to Sales form validates inline with the exact same rules the server
 * applies — one source of truth, no drift between "the form said OK" and
 * "the server said no".
 */
export const INTEREST_OPTIONS = [
  "Experience Management Platform",
  "Reputation Management",
  "Surveys & Feedback",
  "Online Listings",
  "Reviews Monitoring",
  "Something else",
] as const;

const optionalText = z
  .string()
  .trim()
  .max(4000, "Please keep this under 4,000 characters")
  .optional()
  .transform((v) => (v ? v : undefined));

/**
 * Phone is how sales actually reaches an inbound inquiry — an email address
 * alone means the first contact attempt is a message into the void — so it is
 * required. The pattern is deliberately loose: it accepts international
 * prefixes, spaces, dots, dashes and parentheses, and only rejects input that
 * could not be a number at all.
 */
const phone = z
  .string({ error: "Phone number is required" })
  .trim()
  .min(1, "Phone number is required")
  .regex(/^[+(]?[\d][\d\s().+-]{5,}$/, "Enter a phone number we can reach you on, e.g. +1 (415) 555-0123")
  .max(40, "That phone number looks too long");

const numberOfUsers = z.coerce
  .number({ error: "Enter how many people will use the platform" })
  .int("Enter a whole number")
  .positive("Enter a number greater than zero")
  .max(1_000_000, "That looks too high — enter the number of people who will use the platform");

/**
 * Shared by every inbound channel (internal New Lead dialog, POST /api/inquiries).
 * Industry stays optional here because internal capture may not know it yet.
 */
export const InquiryInput = z.object({
  companyName: z.string().trim().min(1, "Company name is required"),
  contactName: z.string().trim().min(1, "Your full name is required"),
  workEmail: z.string().trim().min(1, "Work email is required").email("Enter a valid work email, e.g. jane@company.com"),
  phone,
  numberOfUsers,
  // Optional: plenty of inquiries describe the need in their own words
  // instead, and the AI brief raises it as a qualification gap when neither is
  // given rather than the form blocking the customer over it.
  interest: optionalText,
  industry: z.string().trim().optional().transform((v) => (v ? v : undefined)),
  requirements: optionalText,
  additionalInfo: optionalText,
});
export type InquiryInput = z.infer<typeof InquiryInput>;

/** The public Talk to Sales form: industry is mandatory. */
export const TalkToSalesInput = InquiryInput.extend({
  industry: z.enum([...INDUSTRIES] as [string, ...string[]], { error: "Select your industry" }),
});
export type TalkToSalesInput = z.infer<typeof TalkToSalesInput>;

export type TalkToSalesField = keyof TalkToSalesInput;

/** Flatten zod issues into { field: firstMessage }. */
export function fieldErrors(error: z.ZodError): Partial<Record<TalkToSalesField, string>> {
  const out: Partial<Record<TalkToSalesField, string>> = {};
  for (const issue of error.issues) {
    const key = issue.path[0] as TalkToSalesField;
    if (key && !out[key]) out[key] = issue.message;
  }
  return out;
}
