"use client";

import { useRouter } from "next/navigation";
import { ChevronsUpDown } from "lucide-react";
import { DOWNSTREAM } from "@/lib/modules";

/**
 * Switch between the deals already across the handoff boundary, from the header
 * of the Ready to Contract page.
 *
 * The options are this workspace's own opportunities — quoted or won — so the
 * account a rep picks here is always one of theirs. The contract module is never
 * asked for an account list of its own; it is told which customer to show.
 */
export function OpportunitySwitcher({
  current,
  options,
}: {
  current: string;
  options: { id: string; label: string; hint: string | null }[];
}) {
  const router = useRouter();
  if (options.length === 0) return null;

  return (
    <span className="relative inline-flex min-w-0 items-center">
      <select
        aria-label={`Opportunity in ${DOWNSTREAM.name}`}
        value={current}
        onChange={(e) => router.push(`${DOWNSTREAM.route}?lead=${e.target.value}`)}
        className="max-w-[16rem] cursor-pointer appearance-none truncate rounded-md border border-transparent bg-transparent py-1 pl-1 pr-6 text-sm font-medium text-foreground hover:border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.hint ? `${o.label} · ${o.hint}` : o.label}
          </option>
        ))}
      </select>
      <ChevronsUpDown aria-hidden className="pointer-events-none absolute right-1 h-3.5 w-3.5 text-muted-foreground" />
    </span>
  );
}
