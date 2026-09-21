"use client";

import { useState } from "react";
import { CalendarPlus } from "lucide-react";
import { format, addDays } from "date-fns";
import { scheduleFollowUpAction } from "@/app/actions/followups";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const KINDS = ["Discovery call", "Follow-up call", "Demo", "Pricing review"];

/** Rep books the next touchpoint from the workspace; it lands on the timeline as "Call booked". */
export function ScheduleFollowUpDialog({ leadId, size = "sm" }: { leadId: string; size?: "sm" | "default" }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState(KINDS[1]);
  const tomorrow = format(addDays(new Date(), 1), "yyyy-MM-dd");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size={size} variant="outline" className="gap-1.5">
          <CalendarPlus className="h-3.5 w-3.5" /> Schedule
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Schedule a follow-up</DialogTitle>
        </DialogHeader>
        <form
          action={async (formData) => {
            await scheduleFollowUpAction(leadId, formData);
            setOpen(false);
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label>What</Label>
            <input type="hidden" name="title" value={kind} />
            <Select value={kind} onValueChange={setKind}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="fu-date">Date</Label>
              <Input id="fu-date" type="date" name="date" defaultValue={tomorrow} min={format(new Date(), "yyyy-MM-dd")} required />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fu-time">Time</Label>
              <Input id="fu-time" type="time" name="time" defaultValue="10:00" step={900} required />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="fu-note">Agenda (optional)</Label>
            <Textarea id="fu-note" name="note" rows={2} placeholder="What to cover — e.g. confirm decision timeline and budget" />
          </div>
          <Button type="submit" className="w-full">
            Book it
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
