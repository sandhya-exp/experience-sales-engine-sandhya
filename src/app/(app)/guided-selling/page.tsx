import Link from "next/link";
import { ArrowRight, ExternalLink } from "lucide-react";
import { listLeadRows } from "@/lib/repo/leads";
import { listContactsForCompany } from "@/lib/repo/contacts";
import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { getQuoteWorkspaceConfig, quoteWorkspaceUrlFor, accountKeyFor, buildHandoffPayload, deliverHandoff } from "@/lib/handoff";
import { computeReadiness } from "@/lib/readiness";
import { DOWNSTREAM } from "@/lib/modules";
import { formatActivityTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Guided Selling — the handoff boundary. Left: opportunities already in Guided Selling
 * and qualified opportunities ready to continue. Right: the Guided Selling module
 * (modules/guided-selling) embedded for the selected opportunity — handoff → Customer 360
 * → quote/contract → signing → documents → renewal.
 */
export default async function GuidedSellingPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const selected = typeof sp.lead === "string" ? sp.lead : null;
  const rows = await listLeadRows();
  const cfg = getQuoteWorkspaceConfig();

  const inModule = rows.filter((r) => r.status === "quoted" || r.status === "won");
  const qualified = rows.filter((r) => r.status === "qualified");
  const ready: typeof qualified = [];
  for (const r of qualified) {
    const contacts = await listContactsForCompany(r.company_id);
    if (computeReadiness(r, contacts).complete) ready.push(r);
  }
  const urlFor = (r: (typeof rows)[number]) =>
    quoteWorkspaceUrlFor(accountKeyFor({ id: r.company_id, name: r.company_name, domain: r.company_domain, industry: r.company_industry, created_at: r.created_at }), r.id);

  const current = inModule.find((r) => r.id === selected) ?? null;
  const moduleUp = cfg.baseUrl ? await moduleReachable(cfg.baseUrl) : false;
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
  const embedSrc = cfg.baseUrl ? withEmbed((current && urlFor(current)) ?? cfg.baseUrl) : null;

  return (
    <div className="flex h-[calc(100vh-3.5rem)] min-h-0">
      <aside className="flex w-[22rem] shrink-0 flex-col overflow-y-auto border-r border-border bg-card px-5 pb-8 pt-6">
        <h1 className="text-xl font-bold leading-tight tracking-tight text-foreground">{DOWNSTREAM.name}</h1>
        <p className="mt-0.5 text-[13px] text-muted-foreground">Opportunities in {DOWNSTREAM.name}, and qualified opportunities ready to continue.</p>

        <Section title={`In ${DOWNSTREAM.name}`} count={inModule.length} empty={`No opportunities in ${DOWNSTREAM.name} yet.`}>
          {inModule.map((r) => {
            const active = r.id === current?.id;
            return (
              <li key={r.id}>
                <Link
                  href={`${DOWNSTREAM.route}?lead=${r.id}`}
                  className={cn("flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted", active && "bg-accent hover:bg-accent")}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{r.company_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {r.status === "won" ? "Won" : DOWNSTREAM.name}
                      {r.quote_requested_at ? ` · ${formatActivityTime(r.quote_requested_at)}` : ""}
                      {r.owner_name ? ` · ${r.owner_name}` : ""}
                    </p>
                  </div>
                  <ArrowRight className={cn("h-4 w-4 shrink-0", active ? "text-primary" : "text-muted-foreground/50")} />
                </Link>
              </li>
            );
          })}
        </Section>

        <Section title="Ready to continue" count={ready.length} empty="No qualified opportunities are ready to continue.">
          {ready.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <Link href={`/leads/${r.id}`} className="block truncate text-sm font-semibold text-foreground hover:text-primary">
                  {r.company_name}
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  Qualified{r.number_of_users ? ` · ${r.number_of_users} users` : ""}
                  {r.owner_name ? ` · ${r.owner_name}` : ""}
                </p>
              </div>
              <Button asChild size="sm">
                <Link href={`/leads/${r.id}/quote`}>Continue <ArrowRight className="h-4 w-4" /></Link>
              </Button>
            </li>
          ))}
        </Section>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-background">
        <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-border bg-card px-5">
          <div className="flex min-w-0 items-center gap-2 text-sm">
            <span className="font-semibold text-foreground">{DOWNSTREAM.partner}</span>
            {current && (
              <>
                <span className="text-muted-foreground">/</span>
                <Link href={`/leads/${current.id}`} className="truncate text-muted-foreground hover:text-foreground">
                  {current.company_name}
                </Link>
              </>
            )}
          </div>
          {embedSrc && (
            <a href={embedSrc.replace(/([?&])embed=1&?/, "$1").replace(/[?&]$/, "")} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-primary hover:underline">
              Open in new tab <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>

        {!cfg.baseUrl ? (
          <Empty>{DOWNSTREAM.partner} isn&apos;t configured on this environment.</Empty>
        ) : !moduleUp ? (
          <Empty>{DOWNSTREAM.partner} isn&apos;t running right now.</Empty>
        ) : (
          <iframe key={embedSrc ?? "module"} src={embedSrc ?? undefined} title={DOWNSTREAM.partner} className="h-full w-full flex-1 border-0 bg-background" />
        )}
      </section>
    </div>
  );
}

function withEmbed(url: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}embed=1`;
}

async function moduleKnows(baseUrl: string, leadId: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/handoffs/${encodeURIComponent(leadId)}`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return true; // unreachable: don't attempt a push
  }
}

async function moduleReachable(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, { cache: "no-store", signal: AbortSignal.timeout(1500) });
    return res.ok;
  } catch {
    return false;
  }
}

function Section({ title, count, empty, children }: { title: string; count: number; empty: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-1.5 flex items-center justify-between px-3">
        <p className="section-label">{title}</p>
        <span className="text-xs tabular-nums text-muted-foreground">{count}</span>
      </div>
      {count === 0 ? <p className="px-3 py-2 text-[13px] text-muted-foreground">{empty}</p> : <ul className="space-y-0.5">{children}</ul>}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <p className="text-sm text-muted-foreground">{children}</p>
    </div>
  );
}
