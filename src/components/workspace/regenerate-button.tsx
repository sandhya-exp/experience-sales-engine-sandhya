"use client";

import { useTransition } from "react";
import { RefreshCcw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { regenerateBriefAction } from "@/app/actions/leads";

export function RegenerateButton({ leadId }: { leadId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      size="sm"
      variant="ghost"
      className="h-8 px-2 text-xs text-muted-foreground hover:text-foreground"
      title="Re-run the analysis with the latest data"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await regenerateBriefAction(leadId);
          toast.success("Opportunity intelligence refreshed");
        })
      }
    >
      <RefreshCcw className={pending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} /> Refresh
    </Button>
  );
}
