"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Building2, Megaphone, Users } from "lucide-react";

/** Owner, industry and lead source — the same select styling the Pipeline toolbar uses, pointed at /funnel. */
export function FunnelFilters({ owners, industries, sources }: { owners: { id: string; name: string }[]; industries: string[]; sources: string[] }) {
  const router = useRouter();
  const sp = useSearchParams();
  const go = (key: string, value: string) => {
    const p = new URLSearchParams(sp.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    p.delete("stage");
    p.delete("show");
    const qs = p.toString();
    router.push(qs ? `/funnel?${qs}` : "/funnel");
  };
  const select =
    "h-8 rounded-md border border-input bg-card pl-7 pr-7 text-[13px] text-foreground appearance-none outline-none transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring";
  return (
    <>
      <div className="relative">
        <Users className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <select aria-label="Filter by owner" className={select} value={sp.get("owner") ?? ""} onChange={(e) => go("owner", e.target.value)}>
          <option value="">All owners</option>
          {owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
          <option value="unassigned">Unassigned</option>
        </select>
      </div>
      <div className="relative">
        <Building2 className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <select aria-label="Filter by industry" className={select} value={sp.get("industry") ?? ""} onChange={(e) => go("industry", e.target.value)}>
          <option value="">All industries</option>
          {industries.map((i) => (
            <option key={i} value={i}>
              {i}
            </option>
          ))}
        </select>
      </div>
      <div className="relative">
        <Megaphone className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <select aria-label="Filter by lead source" className={select} value={sp.get("source") ?? ""} onChange={(e) => go("source", e.target.value)}>
          <option value="">All sources</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}
