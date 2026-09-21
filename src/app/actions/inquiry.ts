"use server";

import { redirect } from "next/navigation";
import { InquiryInput, createInquiryLead } from "@/lib/inquiries";

export interface InquiryFormState {
  errors: Record<string, string>;
}

export async function submitInquiry(_prev: InquiryFormState, formData: FormData): Promise<InquiryFormState> {
  const parsed = InquiryInput.safeParse({
    companyName: formData.get("companyName"),
    contactName: formData.get("contactName"),
    workEmail: formData.get("workEmail"),
    phone: formData.get("phone") || undefined,
    numberOfUsers: formData.get("numberOfUsers"),
    interest: formData.get("interest"),
    industry: formData.get("industry") || undefined,
    requirements: formData.get("requirements"),
    additionalInfo: formData.get("additionalInfo") || undefined,
  });

  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      errors[issue.path[0] as string] = issue.message;
    }
    return { errors };
  }

  const { lead } = await createInquiryLead(parsed.data, "customer inquiry");
  // The confirmation page offers the customer a discovery-call slot for this lead.
  redirect(`/inquire/thank-you?lead=${lead.id}`);
}
