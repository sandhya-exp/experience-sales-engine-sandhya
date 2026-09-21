"use client";

import { useRouter } from "next/navigation";
import { TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * A pipeline row that opens the Lead Workspace when clicked anywhere. Keeps
 * a real <a> inside the Company cell for accessibility / middle-click, and
 * ignores clicks that land on that link (so it isn't handled twice).
 */
export function LeadRow({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  const router = useRouter();

  return (
    <TableRow
      role="link"
      tabIndex={0}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a")) return;
        router.push(href);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") router.push(href);
      }}
      className={cn("group cursor-pointer focus-visible:bg-muted/60 focus-visible:outline-none", className)}
    >
      {children}
    </TableRow>
  );
}
