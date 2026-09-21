import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { listLeadRows } from "@/lib/repo/leads";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { requireContractAccess } from "@/lib/authz";
import { getQuoteWorkspaceConfig, accountKeyFor, buildHandoffPayload, deliverHandoff } from "@/lib/handoff";
import { DOWNSTREAM } from "@/lib/modules";
import { quoteModuleStatus, moduleEmbedPath } from "@/lib/quote-module";
import { QuoteModulePanel } from "@/components/workspace/quote-module-panel";
import { OpportunitySwitcher } from "@/components/workspace/opportunity-switcher";

/**
 * Ready to Contract — the handoff boundary, and the contract module itself.
 *
 * The page is the module, full width. There used to be a column of
 * opportunities beside it, which meant three panels of navigation on one screen
 * (this app's sidebar, that list, and the module's own) for a step where the
 * opportunity has already been chosen. Choosing happens where the work is — on
 * the opportunity, with Continue to Contract — so all that is left here is a
 * compact switcher in the header for moving between the deals already across
 * the line.
 */
export default async function GuidedSellingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  // Admin only. The proxy refuses the module itself; this refuses the page.
  await requireContractAccess();
  const sp = await searchParams;
  const selected = typeof sp.lead === "string" ? sp.lead : null;
  const rows = await listLeadRows();
  const cfg = getQuoteWorkspaceConfig();

  // The accounts offered here are this workspace's own deals that have crossed
  // the boundary — quoted or won. The module never sources its own account list.
  const inModule = rows.filter((r) => r.status === "quoted" || r.status === "won");

  const urlFor = (r: (typeof rows)[number]) =>
    moduleEmbedPath(
      accountKeyFor({ id: r.company_id, name: r.company_name, domain: r.company_domain, industry: r.company_industry, created_at: r.created_at }),
      r.id
    );

  // Default to the most recent deal so the page is never an empty module.
  const current = inModule.find((r) => r.id === selected) ?? inModule[0] ?? null;
  const moduleStatus = await quoteModuleStatus();
  const moduleUp = moduleStatus.state === "ok";
  // The module keeps its inbox in memory: if it was restarted (or was down when
  // the opportunity was handed off), re-deliver the same quote context so the
  // same customer/opportunity appears there — never a second one.
  if (current && moduleUp && cfg.baseUrl && !(await moduleKnows(cfg.baseUrl, current.id))) {
    const h = await headers();
    const origin = `${h.get("x-forwarded-proto") ?? "http"}://${h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"}`;
    const user = await getCurrentUser();
    const payload = await buildHandoffPayload(current.id, user?.name ?? "System", origin);
    if (payload) await deliverHandoff(payload);
  }
  // Always embedded: `embed=1` is what tells the module the host already
  // provides the shell, so it drops its own brand block, account picker and
  // left rail and lays its steps out horizontally.
  const embedSrc = cfg.baseUrl ? (current ? urlFor(current) : moduleEmbedPath()) : null;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0 flex-col bg-background">
      <div className="flex h-12 shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5">
        <div className="flex min-w-0 items-center gap-2.5 text-sm">
          <span className="shrink-0 font-semibold text-foreground">{DOWNSTREAM.name}</span>
          {current && (
            <>
              <span className="text-muted-foreground">/</span>
              <OpportunitySwitcher
                current={current.id}
                options={inModule.map((r) => ({
                  id: r.id,
                  label: r.company_name,
                  // Only "Won" is worth the space — everything in this list is
                  // already at this stage, so repeating the stage name truncates
                  // the company name for nothing.
                  hint: r.status === "won" ? "Won" : null,
                }))}
              />
              <Link href={`/leads/${current.id}`} className="hidden shrink-0 text-[13px] text-muted-foreground hover:text-foreground sm:inline">
                Open opportunity
              </Link>
            </>
          )}
        </div>
        {embedSrc && (
          <a
            href={embedSrc.replace(/([?&])embed=1&?/, "$1").replace(/[?&]$/, "")}
            target="_blank"
            rel="noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-primary hover:underline"
          >
            Open in new tab <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>

      <QuoteModulePanel key={embedSrc ?? "none"} status={moduleStatus} embedSrc={embedSrc} />
    </div>
  );
}

async function moduleKnows(baseUrl: string, leadId: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/handoffs/${encodeURIComponent(leadId)}`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return true; // unreachable: don't attempt a push
  }
}
