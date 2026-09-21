"use server";

import { redirect } from "next/navigation";
import { createInquiryLead } from "@/lib/inquiries";
import { TalkToSalesInput, fieldErrors, type TalkToSalesField } from "@/lib/inquiry-schema";

export interface InquiryFormState {
  errors: Partial<Record<TalkToSalesField, string>>;
  /** Set when the request itself failed (not a validation problem). */
  message?: string;
}

/**
 * Talk to Sales submission. Called from the client with an already-validated
 * plain object (the form validates inline with the same schema), re-validated
 * here because the server never trusts the browser. On success it redirects to
 * the confirmation page for this lead; on failure it returns field errors and
 * the form keeps every value the customer typed.
 */
export async function submitTalkToSales(values: Record<string, unknown>): Promise<InquiryFormState> {
  const parsed = TalkToSalesInput.safeParse(values);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  let leadId: string;
  try {
    const { lead } = await createInquiryLead(parsed.data, "Talk to Sales form");
    leadId = lead.id;
  } catch (err) {
    console.error("Talk to Sales submission failed:", err);
    return { errors: {}, message: "Something went wrong on our side. Your details are still in the form — please try again in a moment." };
  }
  // The confirmation page offers the customer a discovery-call slot for this lead.
  redirect(`/inquire/thank-you?lead=${leadId}`);
}

/** Kept for any legacy <form action> caller; the Talk to Sales form uses submitTalkToSales. */
export async function submitInquiry(_prev: InquiryFormState, formData: FormData): Promise<InquiryFormState> {
  return submitTalkToSales(Object.fromEntries(formData.entries()));
}
