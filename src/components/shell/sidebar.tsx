"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarDays, Building2, FileText, Home, KanbanSquare, ListChecks, PackageCheck } from "lucide-react";
import { DOWNSTREAM } from "@/lib/modules";
import { ExperienceLogo } from "@/components/brand/logo";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

/**
 * Left navigation in the VOCE / Experience.com product language: white surface,
 * hairline right border, muted section labels, soft gray active pill.
 *
 * One entry per *place*, never per filter. An earlier version listed every
 * stage, every teammate and every industry here — seventeen entries that led to
 * three pages, so most clicks landed somewhere that looked identical to the
 * last one. Those are filters, and filters belong on the view they filter: the
 * Pipeline page owns stage, owner, industry and date, in its own toolbar, where
 * you can see what is in effect. What is left is the six things a salesperson
 * actually navigates between, plus the contract boundary for admins.
 */
export function Sidebar({
  attentionCount,
  taskCount,
  quoteCount,
  canContract,
}: {
  /** Opportunities flagged as needing attention — shown against Pipeline. */
  attentionCount: number;
  /** Everything outstanding — the number on the Scheduled Tasks entry. */
  taskCount: number;
  /** Quotes currently live with a customer. */
  quoteCount: number;
  /** Admin only: the contract boundary. A Sales User's nav ends at Companies. */
  canContract: boolean;
}) {
  const pathname = usePathname();
  const at = (p: string) => pathname === p || pathname.startsWith(`${p}/`);

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-card lg:flex">
      <Link href="/" className="flex items-center gap-3 border-b border-border px-5 py-4">
        <ExperienceLogo />
      </Link>

      <nav className="flex-1 space-y-6 overflow-y-auto px-3 py-5">
        <div>
          <p className="section-label px-3 pb-2">Sales Engine</p>
          <ul className="space-y-0.5">
            <NavItem href="/" active={pathname === "/"} icon={Home}>
              Home
            </NavItem>
            <NavItem href="/pipeline" active={at("/pipeline")} icon={KanbanSquare} badge={attentionCount > 0 ? attentionCount : undefined} badgeTone="warning">
              Pipeline
            </NavItem>
            <NavItem href="/quotes" active={at("/quotes")} icon={FileText} badge={quoteCount > 0 ? quoteCount : undefined}>
              Quotes
            </NavItem>
            <NavItem href="/reports" active={at("/reports")} icon={BarChart3}>
              Reports
            </NavItem>
          </ul>
        </div>

        <div>
          <p className="section-label px-3 pb-2">Follow-through</p>
          <ul className="space-y-0.5">
            <NavItem href="/tasks" active={at("/tasks")} icon={ListChecks} badge={taskCount > 0 ? taskCount : undefined} badgeTone="warning">
              Scheduled Tasks
            </NavItem>
            <NavItem href="/schedule" active={at("/schedule")} icon={CalendarDays}>
              Schedule
            </NavItem>
            <NavItem href="/companies" active={at("/companies")} icon={Building2}>
              Companies
            </NavItem>
            {canContract && (
              <NavItem href={DOWNSTREAM.route} active={pathname === "/pipeline" && false} icon={PackageCheck}>
                {DOWNSTREAM.navLabel}
              </NavItem>
            )}
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
  badgeTone = "muted",
  children,
}: {
  href: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
  badgeTone?: "muted" | "warning";
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
          <span
            className={cn(
              "rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums",
              badgeTone === "warning" ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
            )}
          >
            {badge}
          </span>
        )}
      </Link>
    </li>
  );
}
