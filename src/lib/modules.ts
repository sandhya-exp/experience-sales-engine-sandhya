/**
 * Naming for the handoff boundary. This workspace owns
 *   Customer Inquiry → Opportunity → Qualification → AI Opportunity Intelligence → Quote Context
 * and hands off into Guided Selling (Quote → Approval → Contract → E-signature → Renewal).
 * Change here (or via env) — no screen hard-codes these words.
 *   NEXT_PUBLIC_STAGE_NAME            the stage an opportunity enters on handoff   (default "Guided Selling")
 *   NEXT_PUBLIC_PARTNER_MODULE_NAME   the downstream module's name                (default "Guided Selling")
 */
const STAGE = process.env.NEXT_PUBLIC_STAGE_NAME?.trim() || "Guided Selling";
const PARTNER = process.env.NEXT_PUBLIC_PARTNER_MODULE_NAME?.trim() || STAGE;

export const DOWNSTREAM = {
  /** The stage: "Guided Selling" */
  name: STAGE,
  /** The module the quote context is handed to (quote → approval → contract → e-signature → renewal) */
  partner: PARTNER,
  /** Header / primary CTA that moves an opportunity across the boundary */
  continueLabel: `Continue to ${STAGE}`,
  updateLabel: `Re-send to ${PARTNER}`,
  openLabel: `Open in ${PARTNER}`,
  inLabel: STAGE,
  navLabel: STAGE,
  route: "/guided-selling",
} as const;
