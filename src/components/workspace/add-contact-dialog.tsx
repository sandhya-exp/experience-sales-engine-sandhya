"use client";

import { useState } from "react";
import { addContactAction } from "@/app/actions/leads";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";

export function AddContactDialog({ leadId, companyId }: { leadId: string; companyId: string }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          + Add Contact
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
        </DialogHeader>
        <form
          action={async (formData) => {
            await addContactAction(leadId, companyId, formData);
            setOpen(false);
          }}
          className="space-y-3"
        >
          <div className="space-y-1">
            <Label>Name</Label>
            <Input name="name" required />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input type="email" name="email" required />
          </div>
          <div className="space-y-1">
            <Label>Title</Label>
            <Input name="title" />
          </div>
          <label className="flex items-center gap-2 text-sm text-foreground">
            <Checkbox name="makePrimary" />
            Make this the primary contact
          </label>
          <Button type="submit" className="w-full">
            Add Contact
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
