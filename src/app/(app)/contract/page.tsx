import Link from "next/link";
import { ArrowRight, ExternalLink, FileText, PackageCheck, Plug } from "lucide-react";
import { listLeadRows } from "@/lib/repo/leads";
import { listOpenQuotes, formatMoney, effectiveStatus } from "@/lib/repo/quotes";
import { query } from "@/lib/db";
import { DOWNSTREAM } from "@/lib/modules";
import { KpiTile } from "@/components/reports/charts";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatActivityTime } from "@/lib/format";

/**
 * Ready to Contract — the handoff surface, not another pipeline.
 *
 * The Pipeline shows these deals as a stage; this page shows what the
 * contract module needs from each: whether the quote context has been
 * recorded, which quote version is current and where it stands, and the
 * door into contracting (quote → approval → contract → e-signature →
 * renewal), which is a separate application that reads
 * GET /api/handoff/{leadId}.
 */
export const dynamic = "force-dynamic";

type HandoffRow = { lead_id: string; occurred_at: string; resend: boolean };

export default async function ContractHandoffPage() {
  const partnerUrl = process.env.NEXT_PUBLIC_PARTNER_MODULE_URL?.trim() || null;
  const [rows, quotes, handoffs] = await Promise.all([
    listLeadRows(),
    listOpenQuotes(),
    query<HandoffRow>(`
      select distinct on (lead_id) lead_id, occurred_at, coalesce((metadata->'handoff'->>'resend')::boolean, false) as resend
        from activities where metadata ? 'handoff'
       order by lead_id, occurred_at desc`),
  ]);
  const ready = rows.filter((r) => r.status === "quoted");
  const quoteByLead = new Map<string, (typeof quotes)[number]>();
  for (const q of quotes) if (!q.meta.superseded && !quoteByLead.has(q.leadId)) quoteByLead.set(q.leadId, q);
  const handoffByLead = new Map(handoffs.map((h) => [h.lead_id, h]));
  const total = ready.reduce((s, r) => s + (quoteByLead.get(r.id)?.meta.total ?? 0), 0);
  const handedOff = ready.filter((r) => handoffByLead.has(r.id)).length;

  return (
    <div className="mx-auto max-w-6xl px-6 pb-12 pt-8">
      <div className="mb-6">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground">{DOWNSTREAM.name}</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Opportunities handed to {DOWNSTREAM.partner} for quote approval, contract, e-signature and renewal. To work the deal itself, open it in the{" "}
          <Link href="/pipeline?stage=quoted" className="font-medium text-primary hover:underline">
            Pipeline
          </Link>
          .
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <KpiTile label={DOWNSTREAM.name} value={String(ready.length)} sub={`${formatMoney(total)} on current quotes`} />
        <KpiTile label="Quote context recorded" value={`${handedOff} / ${ready.length}`} sub="Readable at GET /api/handoff/{id}" tone={handedOff === ready.length && ready.length > 0 ? "success" : undefined} />
        <KpiTile label={`${DOWNSTREAM.partner} module`} value={partnerUrl ? "Linked" : "Not linked"} sub={partnerUrl ? "Opens in the contract app" : "Set NEXT_PUBLIC_PARTNER_MODULE_URL to link it"} tone={partnerUrl ? "success" : "warning"} />
      </div>

      <section className="mt-4 overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
        <div className="flex items-center gap-2 border-b border-border px-6 py-4">
          <PackageCheck className="h-4 w-4 text-navy" />
          <h2 className="text-[14px] font-semibold text-foreground">Handoff status</h2>
        </div>
        {ready.length === 0 ? (
          <p className="px-6 py-12 text-center text-[13px] text-muted-foreground">Nothing is at {DOWNSTREAM.name} right now.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Company</TableHead>
                <TableHead>Current quote</TableHead>
                <TableHead>Quote context</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {ready.map((r) => {
                const q = quoteByLead.get(r.id);
                const h = handoffByLead.get(r.id);
                const qs = q ? effectiveStatus(q.meta) : null;
                return (
                  <TableRow key={r.id}>
                    <TableCell>
                      <p className="font-semibold text-foreground">{r.company_name}</p>
                      <p className="text-[12px] text-muted-foreground">{r.primary_contact_name ?? "No contact"}</p>
                    </TableCell>
                    <TableCell>
                      {q ? (
                        <p className="text-[13px] text-foreground">
                          v{q.meta.version} · {formatMoney(q.meta.total)} <Badge variant={qs === "accepted" ? "success" : qs === "sent" || qs === "viewed" || qs === "approved" ? "navy" : "outline"} className="ml-1 font-medium">{qs}</Badge>
                        </p>
                      ) : (
                        <span className="text-[13px] text-muted-foreground">No quote yet</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {h ? (
                        <span className="text-[13px] text-foreground">
                          Recorded {formatActivityTime(h.occurred_at)}
                          {h.resend ? <span className="text-muted-foreground"> · re-sent</span> : null}
                        </span>
                      ) : (
                        <span className="text-[13px] text-warning">Not recorded — open the deal and use {DOWNSTREAM.continueLabel}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-[13px] text-muted-foreground">{r.owner_name ?? "Unassigned"}</TableCell>
                    <TableCell className="py-1 text-right">
                      <span className="inline-flex items-center gap-3">
                        <Link href={`/api/handoff/${r.id}`} target="_blank" className="inline-flex items-center gap-1 text-[12.5px] text-muted-foreground hover:text-foreground" title="The quote context the contract module reads">
                          <FileText className="h-3.5 w-3.5" /> Context
                        </Link>
                        {partnerUrl ? (
                          <a href={`${partnerUrl.replace(/\/$/, "")}/?lead_id=${r.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
                            {DOWNSTREAM.openLabel} <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <Link href={`/leads/${r.id}?tab=quotes`} className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
                            Open deal <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        )}
                      </span>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </section>

      {!partnerUrl && (
        <p className="mt-4 flex items-start gap-2 rounded-[var(--radius)] border border-border bg-muted/30 px-4 py-3 text-[12.5px] text-muted-foreground">
          <Plug className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            The contract module (quote approval → contract → e-signature → renewal) runs as its own application and reads each deal&rsquo;s quote context from <span className="font-mono">GET /api/handoff/&#123;leadId&#125;</span>. Set <span className="font-mono">NEXT_PUBLIC_PARTNER_MODULE_URL</span> to its address and &ldquo;{DOWNSTREAM.openLabel}&rdquo; will open the deal there.
          </span>
        </p>
      )}
    </div>
  );
}
