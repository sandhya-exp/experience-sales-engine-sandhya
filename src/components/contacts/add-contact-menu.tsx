"use client";

import { useState } from "react";
import { Building2, ChevronDown, FileSpreadsheet, Plug, Plus, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { CreateContactDialog, type TeamOption } from "@/components/contacts/create-contact-dialog";
import { ImportCsvDialog } from "@/components/contacts/import-csv-dialog";
import { AddFromCompanyDialog } from "@/components/contacts/add-from-company-dialog";
import { ExternalContactsDialog } from "@/components/contacts/external-contacts-dialog";

/**
 * "+ Add Contact" — the one menu for every way a contact gets in. On a deal
 * (companyId set) everything lands on that deal's company; from the Companies
 * page the company is matched or chosen first.
 */
export function AddContactMenu({
  companyId,
  companyName,
  leadId,
  team,
  defaultOwnerId,
  size = "sm",
  variant = "outline",
}: {
  companyId?: string | null;
  companyName?: string | null;
  leadId?: string | null;
  team: TeamOption[];
  defaultOwnerId?: string | null;
  size?: "sm" | "default";
  variant?: "outline" | "default" | "navy";
}) {
  const [dialog, setDialog] = useState<null | "create" | "csv" | "company" | "external">(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button size={size} variant={variant} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" /> Add Contact <ChevronDown className="h-3.5 w-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onSelect={() => setDialog("create")} className="gap-2">
            <UserPlus className="h-4 w-4 text-muted-foreground" />
            <span>
              <span className="block">Create contact</span>
              <span className="block text-[11px] text-muted-foreground">Enter the details by hand</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("csv")} className="gap-2">
            <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
            <span>
              <span className="block">Import CSV</span>
              <span className="block text-[11px] text-muted-foreground">Map, validate, de-duplicate, import</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog("company")} className="gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <span>
              <span className="block">Add from existing company</span>
              <span className="block text-[11px] text-muted-foreground">{companyId ? "Bring people over from another account" : "Find the account first — no duplicate companies"}</span>
            </span>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => setDialog("external")} className="gap-2">
            <Plug className="h-4 w-4 text-muted-foreground" />
            <span>
              <span className="block">External contacts</span>
              <span className="block text-[11px] text-muted-foreground">From a connected CRM or contact source</span>
            </span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <CreateContactDialog open={dialog === "create"} onOpenChange={(o) => setDialog(o ? "create" : null)} companyId={companyId} companyName={companyName} leadId={leadId} team={team} defaultOwnerId={defaultOwnerId} />
      <ImportCsvDialog open={dialog === "csv"} onOpenChange={(o) => setDialog(o ? "csv" : null)} companyId={companyId} companyName={companyName} leadId={leadId} />
      <AddFromCompanyDialog open={dialog === "company"} onOpenChange={(o) => setDialog(o ? "company" : null)} targetCompanyId={companyId} targetCompanyName={companyName} leadId={leadId} team={team} />
      <ExternalContactsDialog open={dialog === "external"} onOpenChange={(o) => setDialog(o ? "external" : null)} companyId={companyId} leadId={leadId} onImportCsv={() => setDialog("csv")} />
    </>
  );
}
