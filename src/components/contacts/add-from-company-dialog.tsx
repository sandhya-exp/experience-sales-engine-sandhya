"use client";

import { useEffect, useState } from "react";
import { Building2, Search } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { addContactsFromCompanyAction, listCompanyContactsAction, searchCompaniesAction } from "@/app/actions/contacts";
import type { CompanySearchRow } from "@/lib/repo/companies";
import type { Contact } from "@/lib/types";
import { CreateContactDialog, type TeamOption } from "@/components/contacts/create-contact-dialog";

/**
 * Add from Existing Company.
 *
 * On a deal: search another account and copy selected people onto this
 * company (a contact who moved, a sister account). From the Companies page:
 * find the account first, see who is already on it, and add a new person to
 * *that* record — the step that stops a second "Acme Corp" being created.
 */
export function AddFromCompanyDialog({
  open,
  onOpenChange,
  targetCompanyId,
  targetCompanyName,
  leadId,
  team,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  targetCompanyId?: string | null;
  targetCompanyName?: string | null;
  leadId?: string | null;
  team: TeamOption[];
}) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CompanySearchRow[]>([]);
  const [picked, setPicked] = useState<CompanySearchRow | null>(null);
  const [contacts, setContacts] = useState<Contact[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(async () => setResults(await searchCompaniesAction(q)), 200);
    return () => clearTimeout(t);
  }, [q, open]);

  useEffect(() => {
    if (!picked) return;
    let cancelled = false;
    void listCompanyContactsAction(picked.id).then((list) => {
      if (!cancelled) setContacts(list);
    });
    return () => {
      cancelled = true;
    };
  }, [picked]);

  const pick = (c: CompanySearchRow | null) => {
    setPicked(c);
    setContacts(null);
    setSelected(new Set());
  };

  const reset = () => {
    setQ("");
    setPicked(null);
    setContacts(null);
    setSelected(new Set());
  };

  const copyMode = Boolean(targetCompanyId);

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          onOpenChange(o);
          if (!o) reset();
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-navy" /> Add from existing company
            </DialogTitle>
          </DialogHeader>

          {!picked ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search accounts by name or domain" className="pl-8" />
              </div>
              <ul className="max-h-[320px] divide-y divide-border overflow-auto rounded-lg border border-border">
                {results
                  .filter((c) => c.id !== targetCompanyId)
                  .map((c) => (
                    <li key={c.id}>
                      <button type="button" onClick={() => pick(c)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted/40">
                        <span>
                          <span className="block text-[13px] font-medium text-foreground">{c.name}</span>
                          <span className="block text-[12px] text-muted-foreground">{c.domain ?? "no domain"}{c.industry ? ` · ${c.industry}` : ""}</span>
                        </span>
                        <span className="shrink-0 text-[12px] tabular-nums text-muted-foreground">{c.contact_count} contact{c.contact_count === 1 ? "" : "s"}</span>
                      </button>
                    </li>
                  ))}
                {results.length === 0 && <li className="px-3 py-6 text-center text-[13px] text-muted-foreground">No account matches “{q}”. Use Create Contact to add a new one — the company is created with it.</li>}
              </ul>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[13px]">
                  <span className="font-semibold text-foreground">{picked.name}</span> <span className="text-muted-foreground">· {picked.domain ?? "no domain"}</span>
                </p>
                <Button size="sm" variant="ghost" onClick={() => pick(null)}>
                  Change company
                </Button>
              </div>
              <div className="max-h-[300px] overflow-auto rounded-lg border border-border">
                {contacts === null ? (
                  <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">Loading contacts…</p>
                ) : contacts.length === 0 ? (
                  <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">No contacts on this account yet.</p>
                ) : (
                  <ul className="divide-y divide-border">
                    {contacts.map((c) => (
                      <li key={c.id} className={cn("flex items-center gap-3 px-3 py-2", copyMode && "cursor-pointer hover:bg-muted/40")} onClick={copyMode ? () => setSelected((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; }) : undefined}>
                        {copyMode && <Checkbox checked={selected.has(c.id)} onCheckedChange={() => undefined} aria-label={`Select ${c.name}`} />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-foreground">
                            {c.name} {c.is_primary && <span className="ml-1 text-[11px] font-normal text-muted-foreground">Primary</span>}
                          </span>
                          <span className="block truncate text-[12px] text-muted-foreground">{[c.title, c.email, c.phone].filter(Boolean).join(" · ")}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {copyMode ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] text-muted-foreground">Selected people are added to {targetCompanyName}; {picked.name} keeps its own records. Anyone already on {targetCompanyName} by email is skipped.</p>
                  <Button
                    disabled={busy || selected.size === 0}
                    onClick={async () => {
                      setBusy(true);
                      const r = await addContactsFromCompanyAction(targetCompanyId!, [...selected], leadId ?? null);
                      setBusy(false);
                      if (r.ok) {
                        toast.success(r.detail);
                        onOpenChange(false);
                        reset();
                        router.refresh();
                      } else toast.error(r.detail);
                    }}
                  >
                    {busy ? "Adding…" : `Add ${selected.size || ""} to ${targetCompanyName}`}
                  </Button>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] text-muted-foreground">These people are already on file. Add someone new to this account without creating a duplicate company.</p>
                  <Button onClick={() => setCreateOpen(true)}>Add a contact to {picked.name}</Button>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
      {picked && (
        <CreateContactDialog
          open={createOpen}
          onOpenChange={(o) => {
            setCreateOpen(o);
            if (!o) void listCompanyContactsAction(picked.id).then(setContacts);
          }}
          companyId={picked.id}
          companyName={picked.name}
          leadId={picked.latest_lead_id}
          team={team}
        />
      )}
    </>
  );
}
