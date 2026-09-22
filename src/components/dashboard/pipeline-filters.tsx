"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Users } from "lucide-react";

/**
 * Owner and industry, as dropdowns on the view they filter.
 *
 * These used to be fourteen entries in the left navigation, which made the nav
 * look like a filing cabinet and meant every click landed on this same page
 * with a different query string. As controls they sit next to the search box
 * and the date range, where what is in effect is visible, and they compose with
 * everything else through the URL exactly as before.
 */
export function PipelineFilters({
  team,
  currentUserId,
  industries,
  unassignedCount,
}: {
  team: { id: string; name: string; open_leads: number }[];
  currentUserId: string;
  industries: { industry: string; count: number }[];
  unassignedCount: number;
}) {
  const router = useRouter();
  const sp = useSearchParams();

  const go = (key: string, value: string) => {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    const qs = p.toString();
    router.push(qs ? `/pipeline?${qs}` : "/pipeline");
  };

  const select =
    "h-8 rounded-md border border-input bg-card pl-7 pr-7 text-[13px] text-foreground appearance-none outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring";

  return (
    <>
      <div className="relative">
        <Users className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <select aria-label="Filter by owner" className={select} value={sp.get("owner") ?? ""} onChange={(e) => go("owner", e.target.value)}>
          <option value="">Everyone</option>
          <option value="me">My leads</option>
          {team
            .filter((m) => m.id !== currentUserId)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} ({m.open_leads})
              </option>
            ))}
          {unassignedCount > 0 && <option value="unassigned">Unassigned ({unassignedCount})</option>}
        </select>
      </div>

      <div className="relative">
        <Building2 className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <select aria-label="Filter by industry" className={select} value={sp.get("industry") ?? ""} onChange={(e) => go("industry", e.target.value)}>
          <option value="">All industries</option>
          {industries.map((i) => (
            <option key={i.industry} value={i.industry}>
              {i.industry} ({i.count})
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
