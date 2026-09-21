import Link from "next/link";
import { Search, Plus } from "lucide-react";
import { ExperienceLogo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/shell/user-menu";
import type { SessionUser } from "@/lib/auth";
import { NewLeadDialog } from "@/components/dashboard/new-lead-dialog";
import { NotificationBell } from "@/components/shell/notification-bell";
import { RecentActivityMenu } from "@/components/shell/recent-activity-menu";
import { listRecentActivities } from "@/lib/repo/activities";
import { getNotificationState } from "@/lib/notifications";

/**
 * Slim bar above the content: global search, then the header actions —
 * Recent Activity, New Lead, notifications, profile. Recent Activity ("what
 * happened") and the bell ("what needs my attention") are deliberately
 * separate controls. On large screens the brand lives in the sidebar; below
 * that the sidebar is hidden and the brand mark shows here instead.
 */
export async function TopBar({ user, initialQuery }: { user: SessionUser; initialQuery?: string }) {
  const [notifications, recentActivity] = await Promise.all([getNotificationState(), listRecentActivities(12)]);
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-4 border-b border-border bg-card/90 px-6 backdrop-blur">
      <Link href="/" className="flex items-center gap-3 lg:hidden">
        <ExperienceLogo size="sm" />
      </Link>

      <form action="/pipeline" method="get" role="search" className="relative hidden w-full max-w-md md:block">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          name="q"
          type="search"
          defaultValue={initialQuery ?? ""}
          placeholder="Search leads, companies, or contacts…"
          className="h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:border-primary/40 focus-visible:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/20"
        />
      </form>

      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <RecentActivityMenu initial={recentActivity.map((a) => ({ id: a.id, lead_id: a.lead_id, company_name: a.company_name, type: a.type, body: a.body, actor_name: a.actor_name, occurred_at: a.occurred_at }))} />
        <NewLeadDialog>
          <Button size="sm" className="h-9 px-3.5 text-[13px]">
            <Plus className="h-4 w-4" /> New Lead
          </Button>
        </NewLeadDialog>
        <NotificationBell initial={notifications} />
        <UserMenu user={user} />
      </div>
    </header>
  );
}
