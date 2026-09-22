"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { updateContactAction } from "@/app/actions/leads";
import type { Contact } from "@/lib/types";

/**
 * Correct a contact where the work happens.
 *
 * People change roles and email addresses, and the usual workaround — adding a
 * second contact for the same person — leaves the record with two of them and
 * the quote going to the wrong one. The fields are the same four the add dialog
 * collects, so the two read as one thing.
 *
 * Promotion to primary is offered, demotion is not: unchecking the box on the
 * person who currently holds it would leave the company without a primary
 * contact, which the database would then have to guess about. Making someone
 * else primary is how you move it.
 */
export function EditContactDialog({ leadId, contact }: { leadId: string; contact: Contact }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-[12.5px] text-muted-foreground hover:text-foreground">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Edit contact</DialogTitle>
        </DialogHeader>
        <form
          action={(fd) =>
            start(async () => {
              const r = await updateContactAction(leadId, contact.id, fd);
              if (r.ok) {
                toast.success(r.detail);
                setOpen(false);
              } else toast.error(r.detail);
            })
          }
          className="space-y-3.5"
        >
          <div className="space-y-1.5">
            <Label htmlFor={`ec-name-${contact.id}`}>Full name</Label>
            <Input id={`ec-name-${contact.id}`} name="name" defaultValue={contact.name} required />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`ec-email-${contact.id}`}>Email</Label>
              <Input id={`ec-email-${contact.id}`} name="email" type="email" defaultValue={contact.email} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`ec-phone-${contact.id}`}>Phone</Label>
              <Input id={`ec-phone-${contact.id}`} name="phone" type="tel" defaultValue={contact.phone ?? ""} placeholder="Optional" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`ec-title-${contact.id}`}>Job title</Label>
            <Input id={`ec-title-${contact.id}`} name="title" defaultValue={contact.title ?? ""} placeholder="e.g. VP Customer Experience" />
          </div>

          {contact.is_primary ? (
            <p className="rounded-md bg-muted px-3 py-2 text-[12.5px] text-muted-foreground">
              This is the primary contact. To move it, edit the person who should hold it instead.
            </p>
          ) : (
            <label className="flex items-center gap-2 text-[13px] text-foreground">
              <Checkbox name="makePrimary" />
              Make this the primary contact
            </label>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
