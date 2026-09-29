"use client";

import { useEffect, useState } from "react";
import { Plug, PlugZap } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { commitCsvImportAction, externalSourceStatusAction, planExternalImportAction, type ImportPlan } from "@/app/actions/contacts";
import type { ExternalSourceStatus } from "@/lib/contacts/external";
import { ImportReview } from "@/components/contacts/import-review";

/**
 * External Contacts — the integration entry point, told straight.
 *
 * With a provider configured it pulls contacts into the same
 * validate → dedupe → review → confirm flow as a CSV. With none configured it
 * says so and shows what configuring one takes; it never pretends to sync.
 */
export function ExternalContactsDialog({ open, onOpenChange, companyId, leadId, onImportCsv }: { open: boolean; onOpenChange: (o: boolean) => void; companyId?: string | null; leadId?: string | null; onImportCsv: () => void }) {
  const [status, setStatus] = useState<ExternalSourceStatus | null>(null);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) void externalSourceStatusAction().then(setStatus);
  }, [open]);

  const willWrite = plan?.rows.filter((r) => r.include && (r.status === "create" || r.status === "update")).length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setPlan(null);
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {status?.configured ? <PlugZap className="h-4 w-4 text-success" /> : <Plug className="h-4 w-4 text-muted-foreground" />} External contacts
          </DialogTitle>
        </DialogHeader>

        {!status ? (
          <p className="py-6 text-center text-[13px] text-muted-foreground">Checking configured sources…</p>
        ) : !status.configured ? (
          <div className="space-y-3 text-[13px]">
            <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
              <p className="font-medium text-foreground">No external contact source is connected.</p>
              <p className="mt-1 text-muted-foreground">
                {status.requested
                  ? status.available.some((a) => a.key === status.requested)
                    ? `CONTACT_SOURCE_PROVIDER is set to “${status.requested}” but it is missing: ${status.missingEnv.join(", ") || "its credentials"}.`
                    : `CONTACT_SOURCE_PROVIDER is set to “${status.requested}”, which is not an implemented provider.`
                  : "Sales Engine can import from a CRM or contact platform through a provider adapter, but none is configured for this environment."}
              </p>
            </div>
            <div className="rounded-lg border border-border px-4 py-3">
              <p className="font-medium text-foreground">To connect one</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5 text-muted-foreground">
                <li>
                  Implement <code className="rounded bg-muted px-1 text-[12px]">ExternalContactProvider</code> in <code className="rounded bg-muted px-1 text-[12px]">src/lib/contacts/external.ts</code> for the source (HubSpot, Salesforce, Google Contacts…).
                </li>
                <li>
                  Set <code className="rounded bg-muted px-1 text-[12px]">CONTACT_SOURCE_PROVIDER</code> and the provider&rsquo;s credentials in the environment.
                </li>
                <li>Fetched contacts run through the same validation, duplicate detection and review as a CSV — nothing is written without confirmation.</li>
              </ol>
              {status.available.length > 0 && <p className="mt-2 text-muted-foreground">Implemented providers: {status.available.map((a) => a.name).join(", ")}.</p>}
            </div>
            <div className="flex items-center justify-between gap-3">
              <p className="text-muted-foreground">Meanwhile, every CRM exports CSV — that route is ready now.</p>
              <Button
                variant="outline"
                onClick={() => {
                  onOpenChange(false);
                  onImportCsv();
                }}
              >
                Import a CSV export instead
              </Button>
            </div>
          </div>
        ) : !plan ? (
          <div className="space-y-3 text-[13px]">
            <p className="text-muted-foreground">
              Connected to <span className="font-medium text-foreground">{status.provider?.name}</span>. Fetch the most recently updated contacts and review them before anything is written.
            </p>
            <div className="flex justify-end">
              <Button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const p = await planExternalImportAction({ companyId: companyId ?? null });
                  setBusy(false);
                  if ("error" in p) toast.error(p.error);
                  else setPlan(p);
                }}
              >
                {busy ? "Fetching…" : `Fetch from ${status.provider?.name}`}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <ImportReview plan={plan} onChange={(rows) => setPlan({ ...plan, rows })} />
            <div className="flex justify-end">
              <Button
                disabled={busy || willWrite === 0}
                onClick={async () => {
                  setBusy(true);
                  const r = await commitCsvImportAction(plan.rows, "external_crm", leadId ?? null);
                  setBusy(false);
                  if (r.ok) {
                    toast.success(r.detail);
                    onOpenChange(false);
                  } else toast.error(r.detail);
                }}
              >
                {busy ? "Importing…" : `Import ${willWrite}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
