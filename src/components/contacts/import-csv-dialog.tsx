"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet, Upload } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { CONTACT_FIELD_LABELS, parseCsv, SAMPLE_CSV, suggestMapping, type ContactField } from "@/lib/contacts/csv";
import { commitCsvImportAction, planCsvImportAction, type ImportPlan, type ImportResult, type PlannedRow } from "@/app/actions/contacts";
import { ImportReview } from "@/components/contacts/import-review";

/**
 * Import CSV: Upload → Map → Review → Import.
 *
 * The file is read in the browser; the mapping is guessed from the headers
 * and shown for correction; the server then validates, resolves companies
 * and detects duplicates without writing anything; the user confirms what
 * gets written. On a deal workspace every new person joins that deal's
 * company; from the Companies page rows are matched to accounts by domain.
 */
type Step = "upload" | "map" | "review" | "done";
const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "map", label: "Map fields" },
  { key: "review", label: "Review" },
  { key: "done", label: "Import" },
];
const FIELDS: ContactField[] = ["name", "first_name", "last_name", "email", "phone", "company", "title", "owner", "external_ref", "ignore"];

export function ImportCsvDialog({ open, onOpenChange, companyId, companyName, leadId }: { open: boolean; onOpenChange: (o: boolean) => void; companyId?: string | null; companyName?: string | null; leadId?: string | null }) {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<ContactField[]>([]);
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload");
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setMapping([]);
    setPlan(null);
    setResult(null);
  };

  const loadText = (text: string, name: string) => {
    const parsed = parseCsv(text);
    if (!parsed.headers.length || !parsed.rows.length) {
      toast.error("That file has no rows to import.");
      return;
    }
    setFileName(name);
    setHeaders(parsed.headers);
    setRows(parsed.rows);
    setMapping(suggestMapping(parsed.headers));
    setStep("map");
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    loadText(await f.text(), f.name);
  };

  const hasEmail = mapping.includes("email");
  const hasName = mapping.includes("name") || mapping.includes("first_name") || mapping.includes("last_name");

  const runPlan = async () => {
    setBusy(true);
    try {
      const p = await planCsvImportAction(rows, mapping, { companyId: companyId ?? null });
      setPlan(p);
      setStep("review");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not analyse the file.");
    } finally {
      setBusy(false);
    }
  };

  const runImport = async () => {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await commitCsvImportAction(plan.rows, "csv_import", leadId ?? null);
      setResult(r);
      setStep("done");
      if (r.ok) toast.success(r.detail);
      else toast.error(r.detail);
    } finally {
      setBusy(false);
    }
  };

  const willWrite = plan?.rows.filter((r) => r.include && (r.status === "create" || r.status === "update")).length ?? 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) reset();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-navy" /> Import contacts from CSV
            {companyName && <span className="text-[13px] font-normal text-muted-foreground">· into {companyName}</span>}
          </DialogTitle>
        </DialogHeader>

        <ol className="flex flex-wrap items-center gap-1 text-[12px]">
          {STEPS.map((s, i) => {
            const idx = STEPS.findIndex((x) => x.key === step);
            const state = i < idx ? "done" : i === idx ? "current" : "todo";
            return (
              <li key={s.key} className="flex items-center">
                <span className={cn("rounded-md px-2 py-0.5", state === "current" ? "bg-navy text-white" : state === "done" ? "text-success" : "text-muted-foreground")}>
                  {i + 1}. {s.label}
                </span>
                {i < STEPS.length - 1 && <span className="mx-1 text-muted-foreground/50">→</span>}
              </li>
            );
          })}
        </ol>

        {step === "upload" && (
          <div className="space-y-3">
            <label
              className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border px-6 py-10 text-center hover:border-navy/40 hover:bg-muted/30"
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                void onFile(e.dataTransfer.files?.[0]);
              }}
            >
              <Upload className="h-6 w-6 text-muted-foreground" />
              <p className="text-[14px] font-medium text-foreground">Drop a CSV here, or click to choose a file</p>
              <p className="text-[12px] text-muted-foreground">Any column names — name, email, phone, company, title and owner are recognised automatically. Email is the only required column.</p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => void onFile(e.target.files?.[0])} />
            </label>
            <div className="flex items-center justify-between text-[12px] text-muted-foreground">
              <span>Exports from HubSpot, Salesforce, Google Contacts and Excel all work.</span>
              <Button size="sm" variant="ghost" onClick={() => loadText(SAMPLE_CSV, "sample-contacts.csv")}>
                Try with a sample file
              </Button>
            </div>
          </div>
        )}

        {step === "map" && (
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              <span className="font-medium text-foreground">{fileName}</span> · {rows.length} row{rows.length === 1 ? "" : "s"}. We matched each column to a field; change any that are wrong.
            </p>
            <div className="max-h-[320px] overflow-auto rounded-lg border border-border">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0 bg-muted/60 text-[11px] uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-3 py-1.5 text-left">Column in file</th>
                    <th className="px-3 py-1.5 text-left">Example values</th>
                    <th className="w-48 px-3 py-1.5 text-left">Imports as</th>
                  </tr>
                </thead>
                <tbody>
                  {headers.map((h, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="px-3 py-1.5 font-medium text-foreground">{h || <span className="text-muted-foreground">(blank header)</span>}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {rows
                          .slice(0, 3)
                          .map((r) => r[i])
                          .filter(Boolean)
                          .join(" · ") || "—"}
                      </td>
                      <td className="px-3 py-1">
                        <Select value={mapping[i]} onValueChange={(v) => setMapping(mapping.map((m, j) => (j === i ? (v as ContactField) : m)))}>
                          <SelectTrigger className="h-8 text-[12.5px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FIELDS.map((f) => (
                              <SelectItem key={f} value={f} disabled={f !== "ignore" && f !== mapping[i] && mapping.includes(f)}>
                                {CONTACT_FIELD_LABELS[f]}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!hasEmail && <p className="text-[12.5px] text-destructive">Choose which column holds the email address — contacts are matched by it.</p>}
            {hasEmail && !hasName && <p className="text-[12.5px] text-warning">No name column — names will be taken from the email address.</p>}
            {companyId && mapping.includes("company") && <p className="text-[12.5px] text-muted-foreground">Everyone in this file will be added to {companyName}; the company column is kept for reference only.</p>}
            <div className="flex justify-between">
              <Button variant="ghost" onClick={reset}>
                Choose another file
              </Button>
              <Button onClick={runPlan} disabled={!hasEmail || busy}>
                {busy ? "Checking…" : "Check for duplicates & validate"}
              </Button>
            </div>
          </div>
        )}

        {step === "review" && plan && (
          <div className="space-y-3">
            <ImportReview plan={plan} onChange={(rowsNext: PlannedRow[]) => setPlan({ ...plan, rows: rowsNext })} />
            <div className="flex justify-between">
              <Button variant="ghost" onClick={() => setStep("map")}>
                Back to mapping
              </Button>
              <Button onClick={runImport} disabled={busy || willWrite === 0}>
                {busy ? "Importing…" : `Import ${willWrite} contact${willWrite === 1 ? "" : "s"}`}
              </Button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-3">
            <div className={cn("rounded-lg border px-4 py-3", result.ok ? "border-success/30 bg-success/5" : "border-destructive/30 bg-destructive/5")}>
              <p className="text-[14px] font-semibold text-foreground">{result.ok ? "Import complete" : "Import failed"}</p>
              <p className="mt-0.5 text-[13px] text-muted-foreground">{result.detail}</p>
              {result.ok && (
                <dl className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-4">
                  <Stat n={result.created} label="added" />
                  <Stat n={result.updated} label="updated" />
                  <Stat n={result.companiesCreated} label="new companies" />
                  <Stat n={result.skipped} label="left out" />
                </dl>
              )}
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={reset}>
                Import another file
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div>
      <dt className="text-[18px] font-semibold tabular-nums text-foreground">{n}</dt>
      <dd className="text-muted-foreground">{label}</dd>
    </div>
  );
}
