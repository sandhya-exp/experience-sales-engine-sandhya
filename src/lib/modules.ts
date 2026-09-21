/**
 * Naming for the handoff boundary. This workspace owns
 *   Customer Inquiry → Opportunity → Qualification → AI Opportunity Intelligence → Quote Context
 * and hands off into the quote module (Quote → Approval → Contract → E-signature → Renewal).
 *
 * The stage after Qualification is called **Quote Ready** everywhere a person
 * can read it: sidebar, pipeline column, stage badges, buttons, headings,
 * handoff copy and AI output. The underlying module is still the Guided
 * Selling module — its folder (modules/guided-selling), its route
 * (/guided-selling), its API endpoints and the `quoted` lead status are
 * unchanged, because those are data and integration names, not labels.
 *
 * Change the wording here (or via env) — no screen hard-codes these words.
 *   NEXT_PUBLIC_STAGE_NAME            the stage an opportunity enters on handoff   (default "Quote Ready")
 *   NEXT_PUBLIC_PARTNER_MODULE_NAME   the downstream module's name                (default = stage name)
 */
const STAGE = process.env.NEXT_PUBLIC_STAGE_NAME?.trim() || "Quote Ready";
const PARTNER = process.env.NEXT_PUBLIC_PARTNER_MODULE_NAME?.trim() || STAGE;

export const DOWNSTREAM = {
  /** The stage: "Quote Ready" */
  name: STAGE,
  /** The module the quote context is handed to (quote → approval → contract → e-signature → renewal) */
  partner: PARTNER,
  /** Header / primary CTA that moves an opportunity across the boundary */
  continueLabel: `Continue to ${STAGE}`,
  updateLabel: `Re-send to ${PARTNER}`,
  openLabel: `Open in ${PARTNER}`,
  inLabel: STAGE,
  navLabel: STAGE,
  /** Heading for the readiness checklist — reads better than "<stage> readiness". */
  readinessLabel: "Quote readiness",
  route: "/guided-selling",
} as const;
