"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { RegenerateButton } from "@/components/workspace/regenerate-button";

/**
 * "Updating AI intelligence…" — shown while a background refresh is running.
 *
 * The page derives the state on the server (lib/ai/staleness.ts): a record
 * change newer than the brief means a refresh is in flight. While that holds,
 * this component re-reads the page every few seconds so the new brief and the
 * new recommended action appear on their own, then stops. If nothing lands
 * for a few minutes it says so and offers the manual Refresh.
 */
const POLL_MS = 4_000;
const MAX_POLL_MS = 150_000;

export function IntelligenceStatus({ leadId, state, className }: { leadId: string; state: "fresh" | "updating" | "stale"; className?: string }) {
  const router = useRouter();
  const started = useRef<number | null>(null);

  useEffect(() => {
    if (state !== "updating") {
      started.current = null;
      return;
    }
    started.current ??= Date.now();
    const id = setInterval(() => {
      if (Date.now() - (started.current ?? Date.now()) > MAX_POLL_MS) {
        clearInterval(id);
        return;
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [state, router]);

  if (state === "fresh") return null;
  if (state === "updating") {
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-full border border-navy/20 bg-[#eef2fb] px-2.5 py-1 text-[12px] font-medium text-navy", className)} role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating AI intelligence…
      </span>
    );
  }
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 py-0.5 pl-2.5 pr-1 text-[12px] font-medium text-warning", className)} role="status">
      <AlertCircle className="h-3.5 w-3.5" /> Intelligence may be out of date
      <RegenerateButton leadId={leadId} />
    </span>
  );
}
