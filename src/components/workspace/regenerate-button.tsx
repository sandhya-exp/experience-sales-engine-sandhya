"use client";

import { RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { AiProgress, useAiRun } from "@/components/workspace/ai-progress";

/**
 * Explicit "run the AI now" — the one place a person asks to wait. The run is
 * streamed so the button shows which stage it is on rather than a spinner.
 */
export function RegenerateButton({ leadId, showProgress = true }: { leadId: string; showProgress?: boolean }) {
  const router = useRouter();
  const { run, stage, running } = useAiRun(leadId);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
        title="Re-run the analysis with the latest data"
        disabled={running}
        onClick={async () => {
          const r = await run({ op: "refresh" });
          if (r.ok) {
            toast.success(r.duration_ms ? `Opportunity intelligence refreshed in ${(r.duration_ms / 1000).toFixed(0)}s` : "Opportunity intelligence refreshed");
            router.refresh();
          } else toast.error(r.detail);
        }}
      >
        <RefreshCcw className={running ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> {running ? "Refreshing" : "Refresh"}
      </Button>
      {showProgress && running && <AiProgress op="refresh" stage={stage} />}
    </span>
  );
}
