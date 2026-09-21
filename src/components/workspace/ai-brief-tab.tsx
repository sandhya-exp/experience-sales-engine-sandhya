import { AiBriefCard } from "@/components/workspace/ai-brief-card";
import type { AiDealBrief } from "@/lib/types";

export function AiBriefTab({ leadId, brief }: { leadId: string; brief: AiDealBrief | null }) {
  return <AiBriefCard brief={brief} leadId={leadId} />;
}
