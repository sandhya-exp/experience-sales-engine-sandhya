"use client";

import { useActionState, useState } from "react";
import { createManualLeadAction, type ManualLeadFormState } from "@/app/actions/leads";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { INDUSTRIES } from "@/lib/industries";

const initialState: ManualLeadFormState = { errors: {} };

export function NewLeadDialog({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(createManualLeadAction, initialState);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{children}</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Lead</DialogTitle>
          <DialogDescription>For a phone-in or manually captured inquiry.</DialogDescription>
        </DialogHeader>
        <form action={formAction} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <F label="Company name" error={state.errors.companyName}>
              <Input name="companyName" required />
            </F>
            <F label="Contact name" error={state.errors.contactName}>
              <Input name="contactName" required />
            </F>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label="Email" error={state.errors.email}>
              <Input type="email" name="email" required />
            </F>
            <F label="Phone" error={state.errors.phone}>
              <Input name="phone" required />
            </F>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <F label="Industry" error={state.errors.industry}>
              <Select name="industry">
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {INDUSTRIES.map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </F>
            <F label="Number of users" error={state.errors.numberOfUsers}>
              <Input type="number" min={1} name="numberOfUsers" required />
            </F>
          </div>
          <F label="Interested in" error={state.errors.interest}>
            <Input name="interest" />
          </F>
          <F label="Requirements" error={state.errors.requirements}>
            <Textarea name="requirements" rows={2} required />
          </F>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "Creating..." : "Create Lead"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function F({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
