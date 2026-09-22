/**
 * Naming for the handoff boundary. This workspace owns
 *   Customer Inquiry → Opportunity → Qualification → AI Opportunity Intelligence → Quote Context
 * and hands off from there into contracting (quote → approval → contract →
 * e-signature → renewal), which is a separate application.
 *
 * The stage after Qualification is called **Ready to Contract** everywhere a
 * person can read it: sidebar, pipeline column, stage badges, buttons,
 * headings, handoff copy and AI output. The stored lead status stays `quoted`,
 * because that is data, not a label.
 *
 * Each label is written out rather than templated off the stage name: "Continue
 * to Ready to Contract" is what templating produces, and it reads badly. Change
 * the wording here (or via env) — no screen hard-codes these words.
 *   NEXT_PUBLIC_STAGE_NAME            the stage an opportunity enters on handoff   (default "Ready to Contract")
 *   NEXT_PUBLIC_PARTNER_MODULE_NAME   the downstream module's name                (default = stage name)
 */
const STAGE = process.env.NEXT_PUBLIC_STAGE_NAME?.trim() || "Ready to Contract";
const PARTNER = process.env.NEXT_PUBLIC_PARTNER_MODULE_NAME?.trim() || STAGE;

export const DOWNSTREAM = {
  /** The stage: "Ready to Contract" */
  name: STAGE,
  /** Who the quote context is handed to (quote → approval → contract → e-signature → renewal) */
  partner: PARTNER,
  /** Header / primary CTA that moves an opportunity across the boundary */
  continueLabel: "Continue to Contract",
  updateLabel: "Re-send to Contract",
  openLabel: "Open in Contract",
  inLabel: STAGE,
  navLabel: STAGE,
  /** Heading for the readiness checklist. */
  readinessLabel: "Contract readiness",
  /** Where "Ready to Contract" leads inside this app: its own pipeline stage. */
  route: "/pipeline?stage=quoted",
} as const;
