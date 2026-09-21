import Link from "next/link";
import { Building2, Search, Users, ArrowRight } from "lucide-react";
import { listCompanyRows } from "@/lib/repo/companies";
import { listLeadRows } from "@/lib/repo/leads";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/types";
import { StageBadge } from "@/components/dashboard/leads-table";
import { formatActivityTime } from "@/lib/format";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * Companies — every account the Sales Engine already knows.
 *
 * This is a view, not a new entity. It reads the same `companies`, `contacts`
 * and `leads` rows the rest of the workspace uses, so an inquiry from a domain
 * that is already here attaches to the existing account (see
 * findOrCreateCompanyForEmail) instead of creating a second one. The point of
 * the screen is precisely that: before you create anything, look here.
 */
export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.toLowerCase().trim() : "";
  const industry = typeof params.industry === "string" ? params.industry : "";
  const filter = typeof params.filter === "string" ? params.filter : "all"; // all | customers | prospects

  const [companies, leads] = await Promise.all([listCompanyRows(), listLeadRows()]);
  const leadsByCompany = new Map<string, typeof leads>();
  for (const l of leads) {
    const list = leadsByCompany.get(l.company_id) ?? [];
    list.push(l);
    leadsByCompany.set(l.company_id, list);
  }

  const customers = companies.filter((c) => c.won_count > 0).length;
  const prospects = companies.length - customers;

  let rows = companies;
  if (filter === "customers") rows = rows.filter((c) => c.won_count > 0);
  if (filter === "prospects") rows = rows.filter((c) => c.won_count === 0);
  if (industry) rows = rows.filter((c) => (c.industry ?? "Unspecified") === industry);
  if (q) {
    rows = rows.filter((c) =>
      [c.name, c.domain, c.industry, c.primary_contact_name, c.primary_contact_email].filter(Boolean).join(" ").toLowerCase().includes(q)
    );
  }

  const tabs = [
    { key: "all", label: "All accounts", count: companies.length },
    { key: "customers", label: "Customers", count: customers },
    { key: "prospects", label: "Prospects", count: prospects },
  ];
  const withQ = (next: Record<string, string>) => {
    const p = new URLSearchParams();
    const f = next.filter ?? filter;
    const i = next.industry ?? industry;
    if (f && f !== "all") p.set("filter", f);
    if (i) p.set("industry", i);
    if (q) p.set("q", q);
    const s = p.toString();
    return s ? `/companies?${s}` : "/companies";
  };

  return (
    <div className="mx-auto max-w-7xl px-6 pb-12 pt-8">
      <div className="mb-6">
        <h1 className="text-[2rem] font-bold leading-tight tracking-tight text-foreground">Companies</h1>
        <p className="mt-1 text-[15px] text-muted-foreground">
          Every customer and prospect on record, with their contacts and opportunities. Check here before adding an account — a new inquiry from a known domain joins the account that already exists.
        </p>
      </div>

      <section className="overflow-hidden rounded-[var(--radius)] border border-border bg-card card-shadow">
        <div className="flex flex-col gap-3 border-b border-border px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {tabs.map((t) => (
              <Link
                key={t.key}
                href={withQ({ filter: t.key })}
                aria-pressed={filter === t.key}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors",
                  filter === t.key ? "bg-navy text-white" : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {t.label}
                <span className={cn("tabular-nums", filter === t.key ? "text-white/80" : "text-muted-foreground/70")}>{t.count}</span>
              </Link>
            ))}
            {industry && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                <span className="font-normal text-muted-foreground/80">Industry</span> <span className="text-foreground">{industry}</span>
                <Link href={withQ({ industry: "" })} className="hover:text-foreground" aria-label="Clear industry">
                  ×
                </Link>
              </span>
            )}
          </div>
          <form className="flex items-center gap-2" action="/companies" role="search">
            {filter !== "all" && <input type="hidden" name="filter" value={filter} />}
            {industry && <input type="hidden" name="industry" value={industry} />}
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder="Company, domain or contact" className="h-8 w-full pl-8 text-[13px] sm:w-64" />
            </div>
          </form>
        </div>

        {rows.length === 0 ? (
          <p className="px-6 py-12 text-center text-sm text-muted-foreground">No companies match that.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((c) => {
              const companyLeads = leadsByCompany.get(c.id) ?? [];
              const open = companyLeads.filter((l) => l.status !== "won" && l.status !== "lost");
              return (
                <li key={c.id} className="px-6 py-4">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent text-primary">
                          <Building2 className="h-3.5 w-3.5" />
                        </span>
                        <p className="truncate text-[15px] font-semibold text-foreground">{c.name}</p>
                        {c.won_count > 0 && <span className="rounded bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">Customer</span>}
                        {c.industry && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{c.industry}</span>}
                      </div>
                      <p className="mt-1 text-[13px] text-muted-foreground">
                        {c.domain ?? "No company domain"}
                        {c.primary_contact_name && ` · ${c.primary_contact_name}`}
                        {c.primary_contact_email && ` · ${c.primary_contact_email}`}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                        <span className="inline-flex items-center gap-1">
                          <Users className="h-3 w-3" /> {c.contact_count} contact{c.contact_count === 1 ? "" : "s"}
                        </span>
                        <span>
                          {c.opportunity_count} opportunit{c.opportunity_count === 1 ? "y" : "ies"}
                          {c.open_count > 0 && ` · ${c.open_count} open`}
                        </span>
                        {c.total_users ? <span>{c.total_users} users requested</span> : null}
                        {c.owner_name && <span>Owner: {c.owner_name}</span>}
                        {c.last_activity_at && <span>Last activity {formatActivityTime(c.last_activity_at)}</span>}
                      </p>
                    </div>
                    {c.latest_lead_id && (
                      <Link
                        href={`/leads/${c.latest_lead_id}`}
                        className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-primary/40 hover:text-primary"
                      >
                        Open latest <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    )}
                  </div>

                  {companyLeads.length > 0 && (
                    <ul className="mt-2.5 flex flex-wrap gap-1.5">
                      {companyLeads.slice(0, 6).map((l) => (
                        <li key={l.id}>
                          <Link
                            href={`/leads/${l.id}`}
                            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[12px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
                          >
                            <StageBadge status={l.status} />
                            <span className="max-w-[16rem] truncate">{l.interest ?? LEAD_STATUS_LABELS[l.status as LeadStatus]}</span>
                          </Link>
                        </li>
                      ))}
                      {open.length === 0 && companyLeads.length > 0 && (
                        <li className="self-center text-[12px] text-muted-foreground">No open opportunity</li>
                      )}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
