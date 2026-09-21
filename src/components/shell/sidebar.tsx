"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { AlertTriangle, KanbanSquare, Inbox, CalendarDays, Building2, Home, Users, PackageCheck, ListChecks } from "lucide-react";
import { DOWNSTREAM } from "@/lib/modules";
import type { TeamMember } from "@/lib/repo/users";
import { ExperienceLogo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { parseDateRange, type DateRange } from "@/lib/dashboard";
import { format } from "date-fns";

export interface IndustryCount {
  industry: string;
  count: number;
}

/**
 * Left navigation in the VOCE / Experience.com product language: white
 * surface, hairline right border, muted section labels, soft gray active pill.
 * Pinned to the viewport. Sections: brand · Sales Engine · Follow-through ·
 * Team · Industry · Today. The date range lives on the pages it filters
 * (Pipeline, Recent activity) as a start → end field, so the dates in effect
 * are visible rather than hidden behind a dropdown. Filters still compose
 * (stage + date + industry + owner) via the URL.
 */
export function Sidebar({
  attentionCount,
  industries,
  team,
  currentUserId,
  unassignedCount,
  taskCount,
  canContract,
}: {
  attentionCount: number;
  industries: IndustryCount[];
  team: TeamMember[];
  currentUserId: string;
  unassignedCount: number;
  /** Everything outstanding — the number on the Scheduled Tasks entry. */
  taskCount: number;
  /** Admin only: the contract boundary. A Sales User's nav ends at Scheduled Tasks. */
  canContract: boolean;
}) {
  const pathname = usePathname();
  const sp = useSearchParams();
  const stage = sp.get("stage") ?? "all";
  const range = parseDateRange(sp.get("range"));
  const from = sp.get("from") ?? "";
  const to = sp.get("to") ?? "";
  const industry = sp.get("industry") ?? "";
  const owner = sp.get("owner") ?? "";
  const onHome = pathname === "/";
  const onPipeline = pathname === "/pipeline";
  const onActivity = pathname === "/activity";
  const onTasks = pathname.startsWith("/tasks");
  const onSchedule = pathname.startsWith("/schedule");
  const onDownstream = pathname === DOWNSTREAM.route;
  const leadMatch = pathname.match(/^\/leads\/([^/]+)/);
  const downstreamHref = leadMatch ? `${DOWNSTREAM.route}?lead=${leadMatch[1]}` : DOWNSTREAM.route;
  // Filters (date, industry) apply to whichever view you're on; elsewhere they take you to the pipeline.
  const base = onActivity ? "/activity" : "/pipeline";


  /** Build a dashboard URL that keeps every filter except the ones being changed. */
  const href = (next: { stage?: string; range?: string; from?: string; to?: string; industry?: string; owner?: string }) => {
    const p = new URLSearchParams();
    const s = next.stage ?? stage;
    const r = (next.range ?? range) as DateRange;
    const ind = next.industry ?? industry;
    const own = next.owner ?? owner;
    if (own) p.set("owner", own);
    if (s && s !== "all") p.set("stage", s);
    if (r && r !== "all") p.set("range", r);
    if (r === "custom") {
      const f = next.from ?? from;
      const t = next.to ?? to;
      if (f) p.set("from", f);
      if (t) p.set("to", t);
    }
    if (ind) p.set("industry", ind);
    if (onActivity) {
      const t = sp.get("type");
      if (t) p.set("type", t);
    }
    const qs = p.toString();
    return qs ? `${base}?${qs}` : base;
  };


  return (
    <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-border bg-card lg:flex">
      <Link href="/" className="flex items-center gap-3 border-b border-border px-5 py-4">
        <ExperienceLogo />
      </Link>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        {/* Pipeline */}
        <div>
          <p className="section-label px-3 pb-2">Sales Engine</p>
          <ul className="space-y-0.5">
            <NavItem href="/" active={onHome} icon={Home}>
              Home
            </NavItem>
            <NavItem href="/pipeline" active={onPipeline && stage === "all"} icon={KanbanSquare}>
              Sales Pipeline
            </NavItem>
            <NavItem href="/pipeline?stage=new" active={onPipeline && stage === "new"} icon={Inbox}>
              New inquiries
            </NavItem>
            <NavItem
              href="/pipeline?stage=attention"
              active={onPipeline && stage === "attention"}
              icon={AlertTriangle}
              badge={attentionCount > 0 ? attentionCount : undefined}
            >
              Needs attention
            </NavItem>
          </ul>
        </div>

        {/* Follow-through — what has to happen next, and when. Scheduled Tasks
            carries meetings, calls and to-dos in one list; the Schedule page
            (calendar settings, booking history) and Companies are still there,
            linked from the pages that need them rather than from the nav.
            Recent activity is a header action, next to New Lead. */}
        <div>
          <p className="section-label px-3 pb-2">Follow-through</p>
          <ul className="space-y-0.5">
            <NavItem href="/tasks" active={onTasks || onSchedule} icon={ListChecks} badge={taskCount > 0 ? taskCount : undefined}>
              Scheduled Tasks
            </NavItem>
            {canContract && (
              <NavItem href={downstreamHref} active={onDownstream} icon={PackageCheck}>
                {DOWNSTREAM.navLabel}
              </NavItem>
            )}
          </ul>
        </div>

        {/* Team — who owns what. "My leads" for your own book; a colleague's name to cover for them. */}
        <div>
          <p className="section-label px-3 pb-2">Team</p>
          <ul className="space-y-0.5">
            {[
              { key: "", label: "Everyone", count: team.reduce((n, m) => n + m.open_leads, 0) + unassignedCount },
              { key: "me", label: "My leads", count: team.find((m) => m.id === currentUserId)?.open_leads ?? 0 },
            ].map((o) => {
              const active = owner === o.key;
              return (
                <li key={o.key || "all"}>
                  <Link
                    href={href({ owner: o.key })}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                      active ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <Users className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="flex-1">{o.label}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{o.count}</span>
                  </Link>
                </li>
              );
            })}
            {team
              .filter((m) => m.id !== currentUserId)
              .map((m) => {
                const active = owner === m.id;
                return (
                  <li key={m.id}>
                    <Link
                      href={href({ owner: active ? "" : m.id })}
                      className={cn(
                        "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                        active ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent text-[9px] font-semibold text-primary">
                        {m.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}
                      </span>
                      <span className="flex-1 truncate">{m.name}</span>
                      <span className="text-xs tabular-nums text-muted-foreground">{m.open_leads}</span>
                    </Link>
                  </li>
                );
              })}
            {unassignedCount > 0 && (
              <li>
                <Link
                  href={href({ owner: owner === "unassigned" ? "" : "unassigned" })}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                    owner === "unassigned" ? "bg-muted font-semibold text-foreground" : "text-warning hover:bg-muted/60"
                  )}
                >
                  <span className="h-4 w-4 shrink-0 rounded-full border border-dashed border-warning/60" />
                  <span className="flex-1">Unassigned</span>
                  <span className="text-xs tabular-nums">{unassignedCount}</span>
                </Link>
              </li>
            )}
          </ul>
        </div>

        {/* Industry — which categories the pipeline's customers are in */}
        <div>
          <p className="section-label px-3 pb-2">Industry</p>
          <ul className="space-y-0.5">
            <li>
              <Link
                href={href({ industry: "" })}
                className={cn(
                  "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                  !industry ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                )}
              >
                <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">All industries</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {industries.reduce((n, i) => n + i.count, 0)}
                </span>
              </Link>
            </li>
            {industries.map((i) => {
              const active = industry === i.industry;
              return (
                <li key={i.industry}>
                  <Link
                    href={href({ industry: active ? "" : i.industry })}
                    aria-pressed={active}
                    className={cn(
                      "flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
                      active ? "bg-muted font-semibold text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-primary" : "bg-border")} />
                    <span className="flex-1 truncate">{i.industry}</span>
                    <span className="text-xs tabular-nums text-muted-foreground">{i.count}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>

      </nav>

      <div className="flex items-center gap-3 border-t border-border px-5 py-4">
        <CalendarDays className="h-4 w-4 text-muted-foreground" />
        <div className="leading-tight">
          <p className="section-label">Today</p>
          <p className="text-sm font-semibold text-foreground">{format(new Date(), "EEE, d MMM yyyy")}</p>
        </div>
      </div>
    </aside>
  );
}

function NavItem({
  href,
  active,
  icon: Icon,
  badge,
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition-colors",
          active ? "bg-muted font-semibold text-foreground" : "text-foreground/80 hover:bg-muted/60 hover:text-foreground"
        )}
      >
        <Icon className={cn("h-4 w-4 shrink-0", active ? "text-foreground" : "text-muted-foreground")} />
        <span className="flex-1">{children}</span>
        {badge !== undefined && (
          <span className="rounded-md bg-warning/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-warning">
            {badge}
          </span>
        )}
      </Link>
    </li>
  );
}
