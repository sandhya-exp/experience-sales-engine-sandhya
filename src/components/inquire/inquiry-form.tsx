"use client";

import { useActionState } from "react";
import { submitInquiry, type InquiryFormState } from "@/app/actions/inquiry";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { IndustryPicker } from "@/components/inquire/industry-picker";

const INTEREST_OPTIONS = [
  "Experience Management Platform",
  "Reputation Management",
  "Surveys & Feedback",
  "Online Listings",
  "Reviews Monitoring",
  "Something else",
];

const initialState: InquiryFormState = { errors: {} };

export function InquiryForm() {
  const [state, formAction, pending] = useActionState(submitInquiry, initialState);

  return (
    <form action={formAction} className="space-y-5">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Company Name" name="companyName" required error={state.errors.companyName}>
          <Input name="companyName" placeholder="Acme Corporation" required />
        </Field>
        <Field label="Full Name" name="contactName" required error={state.errors.contactName}>
          <Input name="contactName" placeholder="Jane Doe" required />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Work Email" name="workEmail" required error={state.errors.workEmail}>
          <Input type="email" name="workEmail" placeholder="jane@acme.com" required />
        </Field>
        <Field label="Phone" name="phone" error={state.errors.phone}>
          <Input name="phone" placeholder="+1 (415) 555-0123" />
        </Field>
      </div>

      <Field label="Your industry" name="industry" error={state.errors.industry}>
        <IndustryPicker />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Number of Users" name="numberOfUsers" required error={state.errors.numberOfUsers}>
          <Input type="number" min={1} name="numberOfUsers" placeholder="250" required />
        </Field>
        <Field label="What are you interested in?" name="interest" required error={state.errors.interest}>
          <Select name="interest" required defaultValue={INTEREST_OPTIONS[0]}>
            <SelectTrigger>
              <SelectValue placeholder="Select an area" />
            </SelectTrigger>
            <SelectContent>
              {INTEREST_OPTIONS.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Field label="What are you looking to achieve?" name="requirements" required error={state.errors.requirements}>
        <Textarea
          name="requirements"
          rows={3}
          placeholder="We're looking for surveys and reputation management across 15 branches."
          required
        />
      </Field>

      <Field label="Additional Information" name="additionalInfo" error={state.errors.additionalInfo}>
        <Textarea name="additionalInfo" rows={2} placeholder="Anything else that would help us prepare (optional)" />
      </Field>

      <Button type="submit" className="w-full" size="lg" disabled={pending}>
        {pending ? "Submitting…" : "Submit Inquiry"}
      </Button>
    </form>
  );
}

function Field({
  label,
  name,
  required,
  error,
  children,
}: {
  label: string;
  name: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={name}>
        {label} {required && <span className="text-destructive">*</span>}
      </Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
