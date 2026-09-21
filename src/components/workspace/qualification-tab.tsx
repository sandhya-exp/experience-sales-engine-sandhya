"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updateQualificationAction } from "@/app/actions/leads";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Contact, Lead, QualificationStatus } from "@/lib/types";
import { computeReadiness } from "@/lib/readiness";
import { Hint, FIELD_HINTS } from "@/components/ui/hint";

const STATUS_LABEL: Record<QualificationStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  qualified: "Qualified",
};

export function QualificationTab({ lead, contacts, focus }: { lead: Lead; contacts: Contact[]; focus: string | null }) {
  const readiness = computeReadiness(lead, contacts);
  return (
    <div className="max-w-3xl">
      <QualificationForm key={lead.updated_at} lead={lead} focus={focus} missing={readiness.missing} />
    </div>
  );
}

// Keyed on `lead.updated_at` by the wrapper above, so that whenever a save
// changes the server data (including the auto-progressed stage), this whole
// form remounts and its local `status` state re-derives from the fresh
// lead instead of drifting from what the server actually persisted.
function QualificationForm({ lead, focus, missing }: { lead: Lead; focus: string | null; missing: string[] }) {
  const fp = (name: string) => ({ id: `qual-${name}`, autoFocus: focus === name, className: focus === name ? "ring-2 ring-primary/40 border-primary/50" : undefined });
  const [status, setStatus] = useState<QualificationStatus>(lead.qualification_status);
  const q = lead.qualification ?? {};

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Qualification</CardTitle>
          {missing.length > 0 && <p className="mt-0.5 text-xs text-muted-foreground">Missing: {missing.join(", ")}</p>}
        </div>
        <Badge variant={status === "qualified" ? "success" : status === "in_progress" ? "warning" : "outline"}>
          {STATUS_LABEL[status]}
        </Badge>
      </CardHeader>
      <CardContent className="pt-0">
        <form
          action={async (formData) => {
            await updateQualificationAction(lead.id, formData);
            toast.success("Qualification saved");
          }}
          className="space-y-4"
        >
          <input type="hidden" name="qualification_status" value={status} />
          <div className="grid grid-cols-2 gap-4">
            <F label="Number of users" hint={FIELD_HINTS.number_of_users}>
              <Input type="number" name="number_of_users" {...fp("number_of_users")} defaultValue={q.number_of_users ?? lead.number_of_users ?? ""} />
            </F>
            <F label="Decision timeline" hint={FIELD_HINTS.decision_timeline}>
              <Input name="decision_timeline" {...fp("decision_timeline")} defaultValue={q.decision_timeline ?? ""} placeholder="e.g. Within 3 months" />
            </F>
            <F label="Current solution" hint={FIELD_HINTS.current_solution}>
              <Input name="current_solution" {...fp("current_solution")} defaultValue={q.current_solution ?? ""} />
            </F>
            <F label="Decision maker" hint={FIELD_HINTS.decision_maker}>
              <Input name="decision_maker" {...fp("decision_maker")} defaultValue={q.decision_maker ?? ""} />
            </F>
            <F label="Primary need" hint={FIELD_HINTS.primary_need}>
              <Input name="primary_need" {...fp("primary_need")} defaultValue={q.primary_need ?? ""} />
            </F>
            <F label="Budget" hint={FIELD_HINTS.budget}>
              <Input name="budget" {...fp("budget")} defaultValue={q.budget ?? ""} placeholder="e.g. $20k/year" />
            </F>
          </div>

          <div className="max-w-56 space-y-1">
            <Label>Qualification status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as QualificationStatus)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="not_started">Not started</SelectItem>
                <SelectItem value="in_progress">In progress</SelectItem>
                <SelectItem value="qualified">Qualified</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button type="submit">Save</Button>
        </form>
      </CardContent>
    </Card>
  );
}

function F({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="flex items-center">
        {label}
        {hint && <Hint text={hint} />}
      </Label>
      {children}
    </div>
  );
}
