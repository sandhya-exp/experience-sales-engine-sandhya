import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { X } from "lucide-react";
import { getWorkspaceData } from "@/lib/repo/workspace";
import { getQuoteWorkspaceConfig, buildHandoffPayload } from "@/lib/handoff";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { hasContractAccess } from "@/lib/authz";
import { DOWNSTREAM } from "@/lib/modules";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { QuoteHandoffConfirm } from "@/components/workspace/quote-handoff-confirm";

// Quote Context review: exactly what Quote Ready receives, and the one button
// that sends it (see src/lib/handoff.ts and docs/QUOTE_HANDOFF.md).
export default async function QuoteHandoffPage({ params }: PageProps<"/leads/[id]/quote">) {
  const { id } = await params;
  // Admin only — the quote context review is the handoff itself.
  if (!(await hasContractAccess())) redirect(`/leads/${id}`);
  const data = await getWorkspaceData(id);
  if (!data) notFound();
  const { lead, company, contacts } = data;

  if (lead.status !== "qualified" && lead.status !== "quoted" && lead.status !== "won") {
    redirect(`/leads/${id}`);
  }

  const configured = Boolean(getQuoteWorkspaceConfig().baseUrl);
  const alreadyQuoted = lead.status !== "qualified";
  const requoting = !alreadyQuoted && Boolean(lead.quote_requested_at);
  const primary = contacts.find((c) => c.id === lead.primary_contact_id) ?? contacts.find((c) => c.is_primary) ?? contacts[0];
  const h = await headers();
  const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host") ?? "localhost:3000"}`;
  const user = await getCurrentUser();
  // The exact payload that will be sent — rendered, not paraphrased.
  const payload = await buildHandoffPayload(id, user?.name ?? "System", origin);

  return (
    <div className="flex min-h-[calc(100vh-3.5rem)] items-center justify-center bg-muted/40 px-4 py-10">
      <Card className="w-full max-w-2xl">
        <CardContent className="p-8">
          <div className="mb-6 flex items-start justify-between">
            <div className="flex items-center gap-3">
              <Avatar className="h-10 w-10">
                <AvatarFallback>{company.name.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div>
                <h1 className="text-lg font-semibold text-foreground">{company.name}</h1>
                <p className="text-sm text-muted-foreground">
                  {primary ? `${primary.name} · ` : ""}
                  {contacts.length} contact{contacts.length === 1 ? "" : "s"}
                </p>
              </div>
            </div>
            <Link href={`/leads/${id}`} className="text-muted-foreground hover:text-foreground" aria-label="Close">
              <X className="h-4 w-4" />
            </Link>
          </div>

          {payload && (
            <div className="mb-6 overflow-hidden rounded-lg border border-border">
              <p className="border-b border-border bg-muted/40 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Quote context · shared with {DOWNSTREAM.partner}
              </p>
              <dl className="grid grid-cols-1 text-[13px] sm:grid-cols-2">
                <Field label="Customer" value={`${payload.customer.name}${payload.customer.industry ? ` · ${payload.customer.industry}` : ""}`} />
                <Field label="Users · locations" value={[payload.sizing.users ? `${payload.sizing.users} users` : null, payload.sizing.locations].filter(Boolean).join(" · ") || null} />
                <Field label="Need" value={payload.need.summary ?? payload.need.primary_need} span />
                <Field label="Budget" value={payload.qualification.budget} />
                <Field label="Timeline" value={payload.qualification.decision_timeline} />
                <Field label="Decision maker" value={payload.qualification.decision_maker} />
                <Field label="Current solution" value={payload.qualification.current_solution} />
                <Field label="Integrations" value={payload.need.integrations.length ? payload.need.integrations.join(", ") : null} />
                <Field label="Contacts" value={`${payload.contacts.length} · primary ${payload.contacts.find((c) => c.is_primary)?.name ?? "—"}`} />
                <Field label="Activity" value={`${payload.activity.length} recent touchpoint${payload.activity.length === 1 ? "" : "s"}`} />
                <Field label="Insights" value={`${payload.insights.length} commercial implication${payload.insights.length === 1 ? "" : "s"}`} />
              </dl>
            </div>
          )}

          {!configured && (
            <p className="mb-4 text-xs text-muted-foreground">{DOWNSTREAM.partner} URL is not configured — the handoff is recorded here and can be opened once it is.</p>
          )}

          <div className="flex gap-2">
            <Button asChild variant="outline" className="flex-1">
              <Link href={`/leads/${id}`}>Cancel</Link>
            </Button>
            <div className="flex-[2]">
              <QuoteHandoffConfirm leadId={id} alreadyQuoted={alreadyQuoted} requoting={requoting} />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, value, span }: { label: string; value: string | null; span?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 border-b border-border px-3 py-2 odd:bg-muted/20 sm:border-r ${span ? "sm:col-span-2 sm:border-r-0" : ""}`}>
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className={`truncate text-right font-medium ${value ? "text-foreground" : "text-warning"}`}>{value ?? "Not confirmed"}</dd>
    </div>
  );
}
