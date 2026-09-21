"use client";

import { useState, useTransition } from "react";
import { ArrowRight, AlertCircle } from "lucide-react";
import { submitTalkToSales } from "@/app/actions/inquiry";
import { INTEREST_OPTIONS, TalkToSalesInput, fieldErrors, type TalkToSalesField } from "@/lib/inquiry-schema";
import { INDUSTRIES } from "@/lib/industries";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Values = Record<TalkToSalesField, string>;
type Errors = Partial<Record<TalkToSalesField, string>>;

const EMPTY: Values = {
  companyName: "",
  contactName: "",
  workEmail: "",
  phone: "",
  industry: "",
  numberOfUsers: "",
  interest: "",
  requirements: "",
  additionalInfo: "",
};

/**
 * Talk to Sales — the public entry point. Every field is controlled, so a
 * validation error (client- or server-side) never resets what the customer
 * typed. Validation runs inline against the same zod schema the server uses;
 * the server action is only called once the form is valid, and if it still
 * objects, its field errors land under the fields with all values intact.
 */
export function TalkToSalesForm() {
  const [values, setValues] = useState<Values>(EMPTY);
  const [errors, setErrors] = useState<Errors>({});
  const [touched, setTouched] = useState<Partial<Record<TalkToSalesField, boolean>>>({});
  const [formMessage, setFormMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (field: TalkToSalesField) => (value: string) => {
    setValues((v) => ({ ...v, [field]: value }));
    // Re-validate a field the moment it changes once it has been touched, so the message clears as they fix it.
    if (touched[field]) setErrors((e) => ({ ...e, [field]: validateField(field, { ...values, [field]: value }) }));
  };
  const blur = (field: TalkToSalesField) => () => {
    setTouched((t) => ({ ...t, [field]: true }));
    setErrors((e) => ({ ...e, [field]: validateField(field, values) }));
  };

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormMessage(null);
    const parsed = TalkToSalesInput.safeParse(values);
    if (!parsed.success) {
      const errs = fieldErrors(parsed.error);
      setErrors(errs);
      setTouched(Object.fromEntries(Object.keys(EMPTY).map((k) => [k, true])));
      focusFirst(errs);
      return;
    }
    startTransition(async () => {
      const result = await submitTalkToSales(parsed.data);
      // On success the action redirects and never returns here.
      if (result?.errors && Object.keys(result.errors).length) {
        setErrors(result.errors);
        focusFirst(result.errors);
      }
      if (result?.message) setFormMessage(result.message);
    });
  }

  function focusFirst(errs: Errors) {
    const first = (Object.keys(EMPTY) as TalkToSalesField[]).find((k) => errs[k]);
    if (first) document.getElementById(`tts-${first}`)?.focus();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="space-y-6" aria-describedby={formMessage ? "tts-form-message" : undefined}>
      <fieldset className="space-y-4">
        <legend className="section-label">About you</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="tts-companyName" label="Company name" required error={errors.companyName}>
            <Input id="tts-companyName" name="companyName" autoComplete="organization" placeholder="Acme Mortgage" value={values.companyName} onChange={(e) => set("companyName")(e.target.value)} onBlur={blur("companyName")} aria-invalid={!!errors.companyName} aria-describedby={errors.companyName ? "tts-companyName-error" : undefined} />
          </Field>
          <Field id="tts-contactName" label="Full name" required error={errors.contactName}>
            <Input id="tts-contactName" name="contactName" autoComplete="name" placeholder="Jane Doe" value={values.contactName} onChange={(e) => set("contactName")(e.target.value)} onBlur={blur("contactName")} aria-invalid={!!errors.contactName} aria-describedby={errors.contactName ? "tts-contactName-error" : undefined} />
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="tts-workEmail" label="Work email" required error={errors.workEmail}>
            <Input id="tts-workEmail" name="workEmail" type="email" inputMode="email" autoComplete="email" placeholder="jane@acmemortgage.com" value={values.workEmail} onChange={(e) => set("workEmail")(e.target.value)} onBlur={blur("workEmail")} aria-invalid={!!errors.workEmail} aria-describedby={errors.workEmail ? "tts-workEmail-error" : undefined} />
          </Field>
          <Field id="tts-phone" label="Phone" required error={errors.phone}>
            <Input id="tts-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="+1 (415) 555-0123" value={values.phone} onChange={(e) => set("phone")(e.target.value)} onBlur={blur("phone")} aria-invalid={!!errors.phone} />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="section-label">About your business</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="tts-industry" label="Industry" required error={errors.industry}>
            <Select
              value={values.industry || undefined}
              onValueChange={(v) => {
                set("industry")(v);
                setTouched((t) => ({ ...t, industry: true }));
                setErrors((e) => ({ ...e, industry: undefined }));
              }}
              name="industry"
            >
              <SelectTrigger id="tts-industry" aria-invalid={!!errors.industry} aria-describedby={errors.industry ? "tts-industry-error" : undefined} className={cn(errors.industry && "border-destructive focus:ring-destructive/30")} onBlur={blur("industry")}>
                <SelectValue placeholder="Select your industry" />
              </SelectTrigger>
              <SelectContent>
                {INDUSTRIES.map((opt) => (
                  <SelectItem key={opt} value={opt}>
                    {opt}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field id="tts-numberOfUsers" label="Number of users" required hint="People who will use the platform — staff, agents or loan officers." error={errors.numberOfUsers}>
            <Input id="tts-numberOfUsers" name="numberOfUsers" type="number" inputMode="numeric" min={1} step={1} placeholder="250" value={values.numberOfUsers} onChange={(e) => set("numberOfUsers")(e.target.value)} onBlur={blur("numberOfUsers")} aria-invalid={!!errors.numberOfUsers} aria-describedby={errors.numberOfUsers ? "tts-numberOfUsers-error" : "tts-numberOfUsers-hint"} />
          </Field>
        </div>
        <Field id="tts-interest" label="What are you interested in?" optional error={errors.interest}>
          <Select
            value={values.interest || undefined}
            onValueChange={(v) => {
              set("interest")(v);
              setTouched((t) => ({ ...t, interest: true }));
              setErrors((e) => ({ ...e, interest: undefined }));
            }}
            name="interest"
          >
            <SelectTrigger id="tts-interest" aria-invalid={!!errors.interest} aria-describedby={errors.interest ? "tts-interest-error" : undefined} className={cn(errors.interest && "border-destructive focus:ring-destructive/30")} onBlur={blur("interest")}>
              <SelectValue placeholder="Choose an area" />
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
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="section-label">Tell us more</legend>
        <Field id="tts-requirements" label="What are you looking to achieve?" optional error={errors.requirements}>
          <Textarea id="tts-requirements" name="requirements" rows={3} placeholder="e.g. Review requests at closing for every loan officer across our branches, with results by region." value={values.requirements} onChange={(e) => set("requirements")(e.target.value)} onBlur={blur("requirements")} aria-invalid={!!errors.requirements} />
        </Field>
        <Field id="tts-additionalInfo" label="Additional information" optional error={errors.additionalInfo}>
          <Textarea id="tts-additionalInfo" name="additionalInfo" rows={2} placeholder="Timeline, systems you use today, anyone else we should include…" value={values.additionalInfo} onChange={(e) => set("additionalInfo")(e.target.value)} onBlur={blur("additionalInfo")} aria-invalid={!!errors.additionalInfo} />
        </Field>
      </fieldset>

      {formMessage && (
        <p id="tts-form-message" role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[13px] text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {formMessage}
        </p>
      )}

      <div className="space-y-2">
        <Button type="submit" className="w-full" size="lg" disabled={pending}>
          {pending ? "Sending…" : "Talk to Sales"}
          {!pending && <ArrowRight className="h-4 w-4" />}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          <span className="text-destructive">*</span> Required. We reply within one business day.
        </p>
      </div>
    </form>
  );
}

function validateField(field: TalkToSalesField, values: Values): string | undefined {
  const shape = TalkToSalesInput.shape[field];
  const r = shape.safeParse(values[field]);
  return r.success ? undefined : r.error.issues[0]?.message;
}

function Field({
  id,
  label,
  required,
  optional,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  optional?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="flex items-baseline justify-between gap-2">
        <span>
          {label}
          {required && (
            <span className="ml-0.5 text-destructive" aria-hidden>
              *
            </span>
          )}
          {required && <span className="sr-only"> (required)</span>}
        </span>
        {optional && <span className="text-[11px] font-normal text-muted-foreground">Optional</span>}
      </Label>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="flex items-start gap-1 text-xs text-destructive">
          <AlertCircle className="mt-[1px] h-3 w-3 shrink-0" /> {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
