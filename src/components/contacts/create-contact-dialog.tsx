"use client";

import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { createContactAction } from "@/app/actions/contacts";

export interface TeamOption {
  id: string;
  name: string;
}

/**
 * Create Contact — the manual path. On a deal the company is fixed and the
 * owner defaults to the deal's owner; from the Companies page the company is
 * inferred from the email domain (or typed) and matched before anything is
 * created, so a manual entry can never spawn a second account.
 */
export function CreateContactDialog({
  open,
  onOpenChange,
  companyId,
  companyName,
  leadId,
  team,
  defaultOwnerId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  companyId?: string | null;
  companyName?: string | null;
  leadId?: string | null;
  team: TeamOption[];
  defaultOwnerId?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [owner, setOwner] = useState<string>(defaultOwnerId ?? "");
  const [makePrimary, setMakePrimary] = useState(false);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create contact</DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            setBusy(true);
            const r = await createContactAction({
              name: String(fd.get("name") ?? ""),
              email: String(fd.get("email") ?? ""),
              phone: String(fd.get("phone") ?? "") || null,
              title: String(fd.get("title") ?? "") || null,
              companyId: companyId ?? null,
              newCompanyName: companyId ? null : String(fd.get("company") ?? "") || null,
              makePrimary,
              ownerUserId: owner || null,
              leadId: leadId ?? null,
            });
            setBusy(false);
            if (r.ok) {
              toast.success(r.detail);
              onOpenChange(false);
              router.refresh();
            } else toast.error(r.detail);
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="cc-name">Name</Label>
              <Input id="cc-name" name="name" required autoComplete="off" placeholder="Dana Whitfield" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-email">Work email</Label>
              <Input id="cc-email" name="email" type="email" required autoComplete="off" placeholder="dana@company.com" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-phone">Phone</Label>
              <Input id="cc-phone" name="phone" type="tel" placeholder="+1 (415) 555-0100" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="cc-title">Job title</Label>
              <Input id="cc-title" name="title" placeholder="VP Customer Experience" />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="cc-company">Company</Label>
            {companyId ? (
              <Input id="cc-company" value={companyName ?? ""} readOnly className="bg-muted/40" />
            ) : (
              <>
                <Input id="cc-company" name="company" placeholder="Leave blank to match by email domain" />
                <p className="text-[11.5px] text-muted-foreground">If the email domain belongs to an account already on file, the contact joins it — a new company is created only when nothing matches.</p>
              </>
            )}
          </div>
          {team.length > 0 && leadId && (
            <div className="space-y-1">
              <Label>Owner</Label>
              <Select value={owner || "none"} onValueChange={(v) => setOwner(v === "none" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Keep the opportunity's owner" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Keep the opportunity&rsquo;s owner</SelectItem>
                  {team.map((m) => (
                    <SelectItem key={m.id} value={m.id}>
                      {m.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11.5px] text-muted-foreground">Ownership lives on the opportunity; this assigns it only if it has no owner yet.</p>
            </div>
          )}
          {companyId && (
            <label className="flex items-center gap-2 text-sm text-foreground">
              <Checkbox checked={makePrimary} onCheckedChange={(v) => setMakePrimary(Boolean(v))} />
              Make this the primary contact
            </label>
          )}
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Saving…" : "Create contact"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
