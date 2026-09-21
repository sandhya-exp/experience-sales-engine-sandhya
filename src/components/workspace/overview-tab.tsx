import Link from "next/link";
import { ArrowRight, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasIntelligence } from "@/components/workspace/ai-brief-card";
import { computeReadiness } from "@/lib/readiness";
import { formatActivityTime, activityLabel } from "@/lib/format";
import type { Activity, AiDealBrief, Company, Contact, Lead } from "@/lib/types";

/**
 * Overview = executive summary. Who, what, where, what needs attention, what
 * next — one line each, linking to the tab that holds the full information.
 */
export function OverviewTab({
  lead,
  company,
  brief,
  contacts,
  activities,
}: {
  lead: Lead;
  company: Company;
  brief: AiDealBrief | null;
  contacts: Contact[];
  activities: Activity[];
}) {
  const readiness = computeReadiness(lead, contacts);
  const intel = hasIntelligence(brief) ? brief.intelligence : null;
  const primary = contacts.find((c) => c.id === lead.primary_contact_id) ?? contacts.find((c) => c.is_primary) ?? contacts[0];
  const q = lead.qualification ?? {};
  const need = [q.primary_need ?? lead.interest, intel?.quote_context.deployment ? `across ${intel.quote_context.deployment}` : null].filter(Boolean).join(" ");
  const tab = (t: string) => `/leads/${lead.id}?tab=${t}`;
  const recent = activities.slice(0, 3);

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
      <Card>
        <CardContent className="divide-y divide-border p-0">
          <Row label="Company">
            <span className="font-medium text-foreground">{company.name}</span>
            <span className="text-muted-foreground">
              {company.industry ? ` · ${company.industry}` : ""}
              {lead.number_of_users ? ` · ${lead.number_of_users} users` : ""}
            </span>
          </Row>
          <Row label="Primary need">
            <span className="font-medium text-foreground">{need || "—"}</span>
          </Row>
          <Row label="What they asked for">
            <span className="text-foreground">{lead.requirements ?? "—"}</span>
          </Row>
          <Row label="Primary contact" action={{ href: tab("contacts"), label: contacts.length > 1 ? `All ${contacts.length} contacts` : "View contact" }}>
            {primary ? (
              <>
                <span className="font-medium text-foreground">{primary.name}</span>
                <span className="text-muted-foreground">{primary.title ? ` · ${primary.title}` : ""}</span>
              </>
            ) : (
              <span className="text-warning">No contact yet</span>
            )}
          </Row>
          <Row label="Qualification" action={{ href: tab("qualification"), label: readiness.complete ? "Review" : "Complete" }}>
            {readiness.complete ? (
              <span className="font-medium text-success">Complete</span>
            ) : (
              <>
                <span className="font-medium text-foreground">
                  {readiness.passed}/{readiness.total} complete
                </span>
                <span className="text-muted-foreground"> · missing {readiness.missing.map((m) => m.toLowerCase()).join(", ")}</span>
              </>
            )}
          </Row>
        </CardContent>
      </Card>

      <div className="space-y-4">
        {intel && (
          <div className="rounded-xl border border-navy/15 bg-[#eef2fb] p-4">
            <p className="section-label flex items-center gap-1.5 text-navy">
              <Sparkles className="h-3 w-3" /> AI next action
            </p>
            <p className="mt-1 text-[15px] font-semibold leading-snug text-foreground">{intel.next_action.action}</p>
            <Link href={tab("brief")} className="mt-2 inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
              View intelligence <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        )}

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 pb-3">
            <CardTitle className="text-sm">Recent activity</CardTitle>
            <Link href={tab("activity")} className="text-[13px] font-medium text-primary hover:underline">
              All
            </Link>
          </CardHeader>
          <CardContent className="pt-0">
            {recent.length === 0 ? (
              <p className="text-sm text-muted-foreground">No activity yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {recent.map((a) => (
                  <li key={a.id} className="py-2 first:pt-0 last:pb-0">
                    <p className="text-xs text-muted-foreground">
                      {formatActivityTime(a.occurred_at)} · {activityLabel(a.type, a.metadata)}
                    </p>
                    {a.body && <p className="line-clamp-1 text-[13px] text-foreground">{a.body}</p>}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function Row({ label, action, children }: { label: string; action?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr_auto] items-baseline gap-3 px-6 py-3 text-sm">
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="min-w-0 leading-snug">{children}</dd>
      {action ? (
        <Link href={action.href} className="inline-flex items-center gap-1 whitespace-nowrap text-[13px] font-medium text-primary hover:underline">
          {action.label} <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      ) : (
        <span />
      )}
    </div>
  );
}
