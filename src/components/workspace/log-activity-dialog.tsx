"use client";

import { useState } from "react";
import { Phone, Mail, MessageSquare, StickyNote } from "lucide-react";
import { logActivityAction } from "@/app/actions/leads";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ActivityType } from "@/lib/types";

const TYPES: { value: ActivityType; label: string; icon: typeof Phone }[] = [
  { value: "call", label: "Call", icon: Phone },
  { value: "email", label: "Email", icon: Mail },
  { value: "message", label: "Message", icon: MessageSquare },
  { value: "note", label: "Note", icon: StickyNote },
];

export function LogActivityDialog({ leadId, defaultType }: { leadId: string; defaultType?: ActivityType }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<ActivityType>(defaultType ?? "call");

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setType(defaultType ?? "call");
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          {defaultType ? TYPES.find((t) => t.value === defaultType)?.label : "Log Activity"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log Activity</DialogTitle>
        </DialogHeader>
        <div className="mb-4 grid grid-cols-4 gap-1 rounded-lg bg-muted p-1">
          {TYPES.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setType(t.value)}
              className={cn(
                "flex flex-col items-center gap-1 rounded-md py-1.5 text-xs font-medium transition-colors",
                type === t.value ? "bg-card text-primary shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <t.icon className="h-4 w-4" /> {t.label}
            </button>
          ))}
        </div>
        <form
          action={async (formData) => {
            await logActivityAction(leadId, formData);
            setOpen(false);
          }}
          className="space-y-3"
        >
          <input type="hidden" name="type" value={type} />
          <div className="space-y-1">
            <Label>{type === "note" ? "Note" : "Summary"}</Label>
            <Textarea name="body" rows={3} required placeholder="What happened?" />
          </div>
          <Button type="submit" className="w-full">
            Save Activity
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
